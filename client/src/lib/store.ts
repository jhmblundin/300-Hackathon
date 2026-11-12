// One socket + one tiny global store for the whole app.

import { useSyncExternalStore } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { Ack, AdminState, HelloAck, MeState, PublicIdea, PublicState } from '../../../shared/types';

export const TOKEN_KEY = 'h300.groupToken';
export const CODE_KEY = 'h300.joinCode';

export type PlayerMode = 'connecting' | 'needCode' | 'viewer' | 'group';

export interface Store {
  connected: boolean;
  pub: PublicState | null;
  ideas: PublicIdea[];
  me: MeState | null;
  admin: AdminState | null;
  /** serverNow - Date.now(), so every screen counts down from the server's clock. */
  clockOffset: number;
  playerMode: PlayerMode;
  codeError: string | null;
}

let state: Store = {
  connected: false,
  pub: null,
  ideas: [],
  me: null,
  admin: null,
  clockOffset: 0,
  playerMode: 'connecting',
  codeError: null,
};
const listeners = new Set<() => void>();

function set(patch: Partial<Store>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function useStore(): Store {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export const socket: Socket = io({ autoConnect: false, path: `${import.meta.env.BASE_URL}socket.io` });

let role: 'player' | 'admin' = 'player';

socket.on('connect', () => {
  set({ connected: true });
  if (role === 'player') playerHello();
});
socket.on('disconnect', () => set({ connected: false }));
socket.on('public', (pub: PublicState) => set({ pub, clockOffset: pub.serverNow - Date.now() }));
socket.on('ideas', (ideas: PublicIdea[]) => set({ ideas }));
socket.on('me', (me: MeState | null) => set({ me }));
socket.on('admin', (admin: AdminState) => set({ admin }));
socket.on('released', () => {
  localStorage.removeItem(TOKEN_KEY);
  set({ me: null, playerMode: 'viewer' });
});

export function connect(as: 'player' | 'admin') {
  role = as;
  if (!socket.connected) socket.connect();
  else if (as === 'player') playerHello();
}

/** Reconnect so the server re-reads the admin cookie after sign-in/out. */
export function reconnect() {
  socket.disconnect();
  set({ admin: null });
  socket.connect();
}

export function emitAck<T = object>(event: string, payload: object): Promise<Ack<T>> {
  return new Promise((resolve) => {
    socket.timeout(8000).emit(event, payload, (err: Error | null, res: Ack<T>) => {
      if (err) resolve({ ok: false, error: 'No response from the server. Check your connection.' });
      else resolve(res);
    });
  });
}

export function adminAction<T = object>(type: string, extra: object = {}) {
  return emitAck<T>('admin:action', { type, ...extra });
}

export function playerHello() {
  const token = localStorage.getItem(TOKEN_KEY);
  const code = localStorage.getItem(CODE_KEY);
  socket.timeout(8000).emit('player:hello', { token, code }, (err: Error | null, res: HelloAck) => {
    if (err) return;
    if (res.ok && res.mode === 'group') {
      set({ playerMode: 'group', codeError: null });
    } else if (res.ok && res.mode === 'viewer') {
      if (res.tokenInvalid) localStorage.removeItem(TOKEN_KEY);
      set({ playerMode: 'viewer', me: null, codeError: null });
    } else if (!res.ok) {
      if (res.error) localStorage.removeItem(CODE_KEY);
      set({ playerMode: 'needCode', codeError: res.error ?? null });
    }
  });
}

export function submitCode(code: string) {
  localStorage.setItem(CODE_KEY, code.trim().toUpperCase());
  playerHello();
}

/** Join the waiting room as a new player. */
export async function joinGame(name: string, code?: string) {
  if (code) localStorage.setItem(CODE_KEY, code.trim().toUpperCase());
  const res = await emitAck<{ token: string; playerId: string }>('player:join', {
    name,
    code: localStorage.getItem(CODE_KEY) ?? '',
  });
  if (res.ok) {
    localStorage.setItem(TOKEN_KEY, res.token);
    set({ playerMode: 'group' });
  } else if (/code/i.test(res.error)) {
    localStorage.removeItem(CODE_KEY);
    set({ playerMode: 'needCode' });
  }
  return res;
}
