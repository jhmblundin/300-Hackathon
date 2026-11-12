// Admin sign-in. Each admin has their own passcode in an env var:
//   ADMIN_JACK_PASSWORD=...   ADMIN_SEAN_PASSWORD=...
// No passcodes configured in production = nobody can sign in (fail closed).

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

export type Admins = Map<string, Buffer>; // display name -> sha256(passcode)

const sha = (s: string) => createHash('sha256').update(s).digest();

export function loadAdmins(env: NodeJS.ProcessEnv, allowDevDefault: boolean): Admins {
  const admins: Admins = new Map();
  for (const [key, value] of Object.entries(env)) {
    const m = /^ADMIN_([A-Z0-9]+)_PASSWORD$/.exec(key);
    if (!m || !value) continue;
    const name = m[1].charAt(0) + m[1].slice(1).toLowerCase();
    if (value.length < 10) console.warn(`[auth] ${key} is short; use 10+ characters.`);
    admins.set(name, sha(value));
  }
  if (!admins.size && allowDevDefault) {
    console.warn('[auth] No ADMIN_<NAME>_PASSWORD set. DEV ONLY: admin passcode is "dev".');
    admins.set('Dev', sha('dev'));
  }
  if (!admins.size) console.error('[auth] No admin passcodes configured. Admin sign-in is disabled.');
  return admins;
}

/** Returns the admin whose passcode matches. Compares against every admin (constant time). */
export function verifyPassword(admins: Admins, password: string): string | null {
  if (!password) return null;
  const h = sha(password);
  let match: string | null = null;
  for (const [name, expected] of admins) {
    if (timingSafeEqual(h, expected)) match = name;
  }
  return match;
}

const sign = (secret: string, body: string) => createHmac('sha256', secret).update(body).digest('base64url');

export function signSession(name: string, secret: string, ttlMs: number): string {
  const body = `${Buffer.from(name).toString('base64url')}.${Date.now() + ttlMs}`;
  return `${body}.${sign(secret, body)}`;
}

export function verifySession(value: string | undefined, secret: string, admins: Admins): string | null {
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 3) return null;
  const [nameB64, exp, mac] = parts;
  const expected = Buffer.from(sign(secret, `${nameB64}.${exp}`));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  if (!(Number(exp) > Date.now())) return null;
  const name = Buffer.from(nameB64, 'base64url').toString();
  return admins.has(name) ? name : null;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    try {
      out[k] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      /* ignore malformed */
    }
  }
  return out;
}

export function clientIp(headers: IncomingHttpHeaders, fallback: string | undefined): string {
  const real = headers['x-real-ip'];
  if (typeof real === 'string' && real) return real;
  const fwd = headers['x-forwarded-for'];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
  return first || fallback || 'unknown';
}

/** Counts failures per key; blocks a key after `max` failures inside the window. */
export class FailureLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();
  constructor(
    private max: number,
    private windowMs: number,
  ) {}

  blocked(key: string): boolean {
    const h = this.hits.get(key);
    if (!h) return false;
    if (Date.now() > h.resetAt) {
      this.hits.delete(key);
      return false;
    }
    return h.count >= this.max;
  }

  fail(key: string) {
    const now = Date.now();
    const h = this.hits.get(key);
    if (!h || now > h.resetAt) this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
    else h.count++;
  }
}
