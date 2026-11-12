import { useEffect, useState } from 'react';
import type { Timer } from '../../../shared/types';

export function useNow(intervalMs = 250) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export type TimerStatus = 'running' | 'paused' | 'done' | 'none';

export function timerInfo(timer: Timer | null | undefined, clockOffset: number, now: number) {
  if (!timer) return { status: 'none' as TimerStatus, remainingMs: 0, fraction: 0 };
  if (timer.endsAt != null) {
    const remainingMs = Math.max(0, timer.endsAt - (now + clockOffset));
    return { status: 'running' as TimerStatus, remainingMs, fraction: timer.durationMs ? remainingMs / timer.durationMs : 0 };
  }
  if (timer.pausedRemainingMs != null) {
    const remainingMs = timer.pausedRemainingMs;
    return { status: 'paused' as TimerStatus, remainingMs, fraction: timer.durationMs ? remainingMs / timer.durationMs : 0 };
  }
  return { status: 'done' as TimerStatus, remainingMs: 0, fraction: 0 };
}

export function fmtClock(ms: number) {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Stable per-group shuffle, so every phone sees ideas in its own order (less order bias). */
export function stableShuffle<T extends { id: string }>(items: T[], seed: string): T[] {
  const h = (s: string) => {
    let x = 2166136261;
    for (let i = 0; i < s.length; i++) {
      x ^= s.charCodeAt(i);
      x = Math.imul(x, 16777619);
    }
    return x >>> 0;
  };
  return [...items].sort((a, b) => h(seed + a.id) - h(seed + b.id));
}
