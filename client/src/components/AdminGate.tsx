import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { connect, reconnect } from '../lib/store';
import { Brand } from './ui';

const AdminName = createContext<string>('');
export const useAdminName = () => useContext(AdminName);

export async function logout() {
  await fetch('/api/admin/logout', { method: 'POST' });
  reconnect();
  window.location.reload();
}

/** Renders children only for a signed-in admin; otherwise a passcode form. */
export function AdminGate({ children, title = 'Admin sign-in' }: { children: ReactNode; title?: string }) {
  const [name, setName] = useState<string | null | undefined>(undefined);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/admin/me')
      .then((r) => r.json())
      .then((r) => setName(r.name ?? null))
      .catch(() => setName(null));
  }, []);

  useEffect(() => {
    if (name) connect('admin');
  }, [name]);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const body = await r.json();
      if (body.ok) {
        setPassword('');
        reconnect();
        setName(body.name);
      } else setError(body.error ?? 'Sign-in failed');
    } catch {
      setError('Could not reach the server');
    } finally {
      setBusy(false);
    }
  }

  if (name === undefined) return <div className="center-msg">Loading…</div>;
  if (!name) {
    return (
      <div className="phone">
        <Brand />
        <form className="card stack" onSubmit={signIn}>
          <h1>{title}</h1>
          <p className="muted">For Jack and Sean only.</p>
          <input
            className="input"
            type="password"
            placeholder="Admin passcode"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
          {error && <p className="error">{error}</p>}
          <button className="btn btn-primary" disabled={busy || !password}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    );
  }
  return <AdminName.Provider value={name}>{children}</AdminName.Provider>;
}
