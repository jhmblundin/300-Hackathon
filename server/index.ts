// HTTP + Socket.IO server. One process holds the game in memory (keep Railway at 1 replica)
// and saves every change to Postgres/file so a restart resumes where it left off.

import { randomBytes } from 'node:crypto';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server, type Socket } from 'socket.io';
import type { Ack, HelloAck } from '../shared/types';
import {
  FailureLimiter,
  clientIp,
  loadAdmins,
  parseCookies,
  signSession,
  verifyPassword,
  verifySession,
} from './auth';
import { BAD_CODE, Game } from './game';
import { createStore } from './store';

declare const __PROD__: boolean | undefined;
const isProd = typeof __PROD__ !== 'undefined' && __PROD__;

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};

const PORT = num(process.env.PORT, 3000);
const COOKIE = 'h300_admin';
/** The app lives under this path (300massave.com/ideaathon rewrites to it). */
const BASE = '/ideaathon';
/** Other sites allowed to open sockets: 300massave.com proxies /ideaathon here. */
const ALLOWED_ORIGIN_HOSTS = new Set(
  (process.env.ALLOWED_ORIGIN_HOSTS ?? '300massave.com,www.300massave.com').split(',').map((h) => h.trim()).filter(Boolean),
);
const SESSION_TTL_MS = 16 * 60 * 60 * 1000;
const gameCfg = {
  submitMs: num(process.env.SUBMIT_SECONDS, 150) * 1000,
  voteMs: num(process.env.VOTE_SECONDS, 180) * 1000,
  superlativeMs: num(process.env.SUPERLATIVE_SECONDS, 60) * 1000,
};

let sessionSecret = process.env.SESSION_SECRET ?? '';
if (sessionSecret.length < 32) {
  if (isProd) console.warn('[auth] SESSION_SECRET missing or short; using a random one (admins sign in again after a restart).');
  sessionSecret = randomBytes(32).toString('hex');
}
const admins = loadAdmins(process.env, !isProd);
/** ADMIN_OPEN=true: no passcode, everyone is an admin (Sean, 2026-11-12). */
const ADMIN_OPEN = process.env.ADMIN_OPEN === 'true';
const adminFrom = (cookie: string | undefined) =>
  ADMIN_OPEN ? 'Admin' : verifySession(parseCookies(cookie)[COOKIE], sessionSecret, admins);

const store = await createStore({
  databaseUrl: process.env.DATABASE_URL ?? '',
  dataDir: process.env.DATA_DIR ?? './data',
});
if (isProd && store.kind === 'file' && !process.env.DATA_DIR) {
  console.warn('[store] No DATABASE_URL: saving to ./data, which Railway wipes on redeploy. Add a Postgres database.');
}
const game = new Game(gameCfg, await store.load());
game.tick();
console.log(`[store] ${store.kind}; phase=${game.state.phase}; groups=${game.state.groups.length}; ideas=${game.state.ideas.length}`);

// ---------- HTTP ----------

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

const health = (_req: express.Request, res: express.Response) => {
  res.json({ ok: true, phase: game.state.phase, storage: store.kind });
};
app.get('/healthz', health);
app.get(`${BASE}/healthz`, health);
app.get('/', (_req, res) => res.redirect(302, `${BASE}/`));

const loginLimiter = new FailureLimiter(10, 10 * 60_000);

app.post(`${BASE}/api/admin/login`, express.json({ limit: '4kb' }), (req, res) => {
  const ip = clientIp(req.headers, req.socket.remoteAddress);
  if (loginLimiter.blocked(ip)) {
    res.status(429).json({ ok: false, error: 'Too many wrong passcodes. Wait 10 minutes.' });
    return;
  }
  const password = typeof req.body?.password === 'string' ? req.body.password.slice(0, 200) : '';
  const name = verifyPassword(admins, password);
  if (!name) {
    loginLimiter.fail(ip);
    console.warn(`[auth] failed admin sign-in from ${ip}`);
    res.status(401).json({ ok: false, error: 'Wrong passcode' });
    return;
  }
  res.cookie(COOKIE, signSession(name, sessionSecret, SESSION_TTL_MS), {
    httpOnly: true,
    sameSite: 'strict',
    secure: req.secure,
    maxAge: SESSION_TTL_MS,
    path: '/',
  });
  console.log(`[auth] ${name} signed in from ${ip}`);
  res.json({ ok: true, name });
});

app.post(`${BASE}/api/admin/logout`, (_req, res) => {
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});

app.get(`${BASE}/api/admin/me`, (req, res) => {
  const name = adminFrom(req.headers.cookie);
  res.setHeader('Cache-Control', 'no-store');
  res.json({ name });
});

const server = http.createServer(app);

if (isProd) {
  const clientDir = fileURLToPath(new URL('../client', import.meta.url));
  app.use(
    BASE,
    express.static(clientDir, {
      index: false,
      setHeaders: (res, file) => {
        if (file.includes('/assets/')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      },
    }),
  );
  app.use((req, res, next) => {
    if (req.method !== 'GET' || !(req.path === BASE || req.path.startsWith(`${BASE}/`))) return next();
    if (req.path.startsWith(`${BASE}/api/`) || req.path.startsWith(`${BASE}/socket.io`)) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile('index.html', { root: clientDir });
  });
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}

// ---------- Socket.IO ----------

const io = new Server(server, {
  serveClient: false,
  // Pages on 300massave.com connect here directly (polling fallback needs CORS; WebSockets don't).
  cors: { origin: [...ALLOWED_ORIGIN_HOSTS].map((h) => `https://${h}`) },
  path: `${BASE}/socket.io`,
  // Phones reach us through 300massave.com's proxy, which only does long-polling: keep polls short.
  pingInterval: 10_000,
  pingTimeout: 20_000,
  maxHttpBufferSize: 64_000,
  // Same-origin only: blocks other websites from opening a socket with an admin's cookie.
  allowRequest: (req, cb) => {
    const origin = req.headers.origin;
    if (!origin) return cb(null, true);
    try {
      const host = (req.headers['x-forwarded-host'] as string | undefined) ?? req.headers.host;
      const o = new URL(origin).host;
      cb(null, o === host || ALLOWED_ORIGIN_HOSTS.has(o));
    } catch {
      cb(null, false);
    }
  },
});

const codeLimiter = new FailureLimiter(30, 60_000);

interface SocketData {
  admin: string | null;
  ip: string;
  groupId: string | null;
  tokenHash: string | null;
  viewer: boolean;
}
type S = Socket<any, any, any, SocketData>;

io.use((socket: S, next) => {
  const h = socket.handshake.headers;
  socket.data.admin = adminFrom(h.cookie);
  socket.data.ip = clientIp(h, socket.handshake.address);
  socket.data.groupId = null;
  socket.data.tokenHash = null;
  socket.data.viewer = false;
  next();
});

let flushTimer: NodeJS.Timeout | null = null;
let lastIdeasJson = '';
let timerHandle: NodeJS.Timeout | null = null;

function flush() {
  flushTimer = null;
  io.to('players').emit('public', game.publicState());
  const ideas = game.publicIdeas();
  const json = JSON.stringify(ideas);
  if (json !== lastIdeasJson) {
    lastIdeasJson = json;
    io.to('players').emit('ideas', ideas);
  }
  for (const pid of Object.keys(game.players())) io.to(`p:${pid}`).emit('me', game.meState(pid));
  io.to('admins').emit('admin', game.adminState());
}

/** Call after every change: saves, schedules a (coalesced) broadcast and the phase timer. */
function changed() {
  store.save(() => game.state);
  if (!flushTimer) flushTimer = setTimeout(flush, 100);
  scheduleTimer();
}

function scheduleTimer() {
  if (timerHandle) clearTimeout(timerHandle);
  timerHandle = null;
  const at = game.nextTimerDeadline();
  if (at == null) return;
  timerHandle = setTimeout(() => {
    if (game.tick()) changed();
    else scheduleTimer();
  }, Math.max(0, at - Date.now()) + 15);
}
scheduleTimer();

function sendFull(socket: S) {
  socket.emit('public', game.publicState());
  socket.emit('ideas', game.publicIdeas());
  if (socket.data.admin) socket.emit('admin', game.adminState());
}

// socket.data.groupId holds the PLAYER id (each phone is one player since 2026-11-12).
function joinAsPlayer(socket: S, playerId: string) {
  const claim = game.players()[playerId];
  if (!claim) return;
  if (socket.data.groupId && socket.data.groupId !== playerId) socket.leave(`p:${socket.data.groupId}`);
  socket.data.groupId = playerId;
  socket.data.tokenHash = claim.tokenHash;
  socket.join(['players', `p:${playerId}`]);
  sendFull(socket);
  socket.emit('me', game.meState(playerId));
}

/** The player this socket is, if its phone's token is still valid. */
function groupOf(socket: S): string | null {
  const { groupId: pid, tokenHash } = socket.data;
  if (pid && tokenHash && game.players()[pid]?.tokenHash === tokenHash) return pid;
  return null;
}

/** Tell phones whose player is gone (a new waiting room was opened) to join again. */
function kickStaleGroups() {
  for (const s of io.sockets.sockets.values() as IterableIterator<S>) {
    if (s.data.groupId && !groupOf(s)) {
      s.leave(`p:${s.data.groupId}`);
      s.data.groupId = null;
      s.data.tokenHash = null;
      s.emit('released');
    }
  }
}

const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');

function handle(socket: S, event: string, fn: (p: any) => Ack<any> | HelloAck) {
  socket.on(event, (payload: unknown, ack: unknown) => {
    let result: Ack<any> | HelloAck;
    try {
      result = fn(payload && typeof payload === 'object' ? payload : {});
    } catch (err) {
      console.error(`[socket] ${event} failed:`, err);
      result = { ok: false, error: 'Something went wrong. Try again.' };
    }
    if (typeof ack === 'function') ack(result);
  });
}

const NOT_JOINED: Ack = { ok: false, error: "You're not on a team yet. Refresh the page." };

io.on('connection', (socket: S) => {
  // Flood guard: a phone can't send more than 150 events per 5 seconds (real tapping is far below this).
  let windowStart = Date.now();
  let count = 0;
  socket.use((packet, next) => {
    const now = Date.now();
    if (now - windowStart > 5000) {
      windowStart = now;
      count = 0;
    }
    if (++count > 150) {
      const ack = packet[packet.length - 1];
      if (typeof ack === 'function') ack({ ok: false, error: 'Slow down a little and try again.' });
      return;
    }
    next();
  });

  if (socket.data.admin) {
    socket.join(['admins', 'players']);
    sendFull(socket);
  }

  handle(socket, 'player:hello', (p): HelloAck => {
    const token = str(p.token, 200);
    const code = str(p.code, 20);
    if (token) {
      const pid = game.playerForToken(token);
      if (pid) {
        joinAsPlayer(socket, pid);
        return { ok: true, mode: 'group', groupId: game.playerGroup(pid)?.id ?? '', playerId: pid };
      }
    }
    if (socket.data.admin || socket.data.viewer) return { ok: true, mode: 'viewer', tokenInvalid: Boolean(token) };
    if (!code) return { ok: false, mode: 'needCode' };
    if (codeLimiter.blocked(socket.data.ip)) return { ok: false, mode: 'needCode', error: 'Too many tries. Wait a minute.' };
    if (!game.checkCode(code)) {
      codeLimiter.fail(socket.data.ip);
      return { ok: false, mode: 'needCode', error: BAD_CODE };
    }
    socket.data.viewer = true;
    socket.join('players');
    sendFull(socket);
    return { ok: true, mode: 'viewer', tokenInvalid: Boolean(token) };
  });

  handle(socket, 'player:join', (p) => {
    if (codeLimiter.blocked(socket.data.ip)) return { ok: false, error: 'Too many tries. Wait a minute.' };
    const r = game.joinPlayer(str(p.name, 80), str(p.code, 20));
    if (!r.ok) {
      if (r.error === BAD_CODE) codeLimiter.fail(socket.data.ip);
      return r;
    }
    socket.data.viewer = true;
    joinAsPlayer(socket, r.playerId);
    changed();
    return r;
  });

  handle(socket, 'player:saveIdea', (p) => {
    const pid = groupOf(socket);
    if (!pid) return NOT_JOINED;
    const r = game.saveIdea(pid, p.slot, str(p.title, 400), str(p.description, 5000));
    if (r.ok) changed();
    return r;
  });

  handle(socket, 'player:vote', (p) => {
    const gid = groupOf(socket);
    if (!gid) return NOT_JOINED;
    const r = game.vote(gid, str(p.ideaId), str(p.kind, 10));
    if (r.ok) changed();
    return r;
  });

  handle(socket, 'player:funniest', (p) => {
    const pid = groupOf(socket);
    if (!pid) return NOT_JOINED;
    const r = game.pickFunniest(pid, str(p.ideaId));
    if (r.ok) changed();
    return r;
  });

  handle(socket, 'player:superlativeVote', (p) => {
    const gid = groupOf(socket);
    if (!gid) return NOT_JOINED;
    const r = game.superlativeVote(gid, p.index, str(p.ideaId));
    if (r.ok) changed();
    return r;
  });

  handle(socket, 'admin:action', (p) => {
    const who = socket.data.admin;
    if (!who) return { ok: false, error: 'Sign in as an admin first' };
    const type = str(p.type, 40);
    let r: Ack<any>;
    switch (type) {
      case 'setParticipants':
        r = game.setParticipants(str(p.text, 50_000));
        break;
      case 'generateGroups':
        r = game.generateGroups();
        break;
      case 'releaseClaim':
        r = game.releaseClaim(str(p.groupId));
        break;
      case 'rotateCode':
        r = game.rotateJoinCode();
        break;
      case 'openLobby':
        r = game.openLobby();
        break;
      case 'start':
        r = game.start();
        break;
      case 'next':
        r = game.next();
        break;
      case 'endTimer':
        r = game.endTimer();
        break;
      case 'pause':
        r = game.pause();
        break;
      case 'resume':
        r = game.resume();
        break;
      case 'addTime':
        r = game.addTime(Number(p.seconds));
        break;
      case 'removeIdea':
        r = game.removeIdea(str(p.ideaId));
        break;
      case 'spotlight':
        r = game.spotlight(p.ideaId ? str(p.ideaId) : null);
        break;
      case 'resetGame':
        r = game.resetGame(p.scope === 'all' ? 'all' : 'game');
        break;
      default:
        r = { ok: false, error: 'Unknown action' };
    }
    if (r.ok) {
      console.log(`[admin] ${who}: ${type} -> phase=${game.state.phase}${game.state.phase === 'superlatives' ? `#${game.state.superlativeIndex + 1}` : ''}`);
      kickStaleGroups();
      changed();
    }
    return r;
  });
});

server.listen(PORT, () => {
  console.log(`[server] listening on :${PORT} (${isProd ? 'production' : 'dev'}); admins: ${[...admins.keys()].join(', ') || 'none'}`);
});

async function shutdown(signal: string) {
  console.log(`[server] ${signal}: saving and shutting down`);
  store.save(() => game.state);
  await store.flush();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
