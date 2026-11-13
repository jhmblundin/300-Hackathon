import confetti from 'canvas-confetti';
import { useEffect, useRef, useState } from 'react';
import { Mark } from '../components/ui';

// Pre-game countdown for the projector (Sean, 2026-11-12). Ends at 8:01pm Boston time.
// The numbers turn from white to red as the end gets close; the last 30 seconds shake, pulse and flash;
// zero explodes, then reads "sike 3 more slides sry". Override the end with ?at=2026-11-12T20:01:00-05:00
const DEFAULT_END = '2026-11-12T20:01:00-05:00';
const RAMP_MS = 20 * 60_000; // white -> red over the last 20 minutes

const mix = (a: number[], b: number[], t: number) => a.map((x, i) => Math.round(x + (b[i] - x) * t));
const WHITE = [246, 246, 244];
const RED = [241, 76, 102];

type Props = { label?: string; endAt?: string; after?: [string, string]; sub?: string };

// /timer is the Idea-a-thon countdown; /building (Sean, 2026-11-12) counts down to 9:20pm and ends on "Go build."
export default function Countdown({
  label = 'Idea-a-thon starts in',
  endAt = DEFAULT_END,
  after = ['sike', '3 more slides sry'],
  sub = '300massave.com/ideaathon',
}: Props) {
  const at = new URLSearchParams(window.location.search).get('at') ?? endAt;
  const end = Date.parse(at);
  const [now, setNow] = useState(Date.now());
  const [boomed, setBoomed] = useState(false);
  const fired = useRef(false);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, []);
  const left = Math.max(0, end - now);
  const done = left === 0;

  useEffect(() => {
    if (!done || fired.current) return;
    fired.current = true;
    const colors = ['#C8102E', '#F6F6F4', '#F14C66', '#FFD23F'];
    confetti({ particleCount: 400, spread: 360, startVelocity: 70, origin: { x: 0.5, y: 0.5 }, colors, scalar: 1.6 });
    setTimeout(() => confetti({ particleCount: 250, spread: 120, origin: { x: 0, y: 0.7 }, angle: 60, colors }), 250);
    setTimeout(() => confetti({ particleCount: 250, spread: 120, origin: { x: 1, y: 0.7 }, angle: 120, colors }), 450);
    setTimeout(() => setBoomed(true), 1400);
  }, [done]);

  const m = Math.floor(left / 60000);
  const s = Math.floor((left % 60000) / 1000);
  const t = Math.min(1, Math.max(0, 1 - left / RAMP_MS)); // 0 far away -> 1 at the end
  const color = `rgb(${mix(WHITE, RED, t * t).join(',')})`;
  const final = !done && left <= 30_000;
  const intensity = final ? 1 - left / 30_000 : 0; // 0 -> 1 over the last 30 s
  const glow = `0 0 ${Math.round(20 + 120 * t * t)}px rgba(200,16,46,${(0.15 + 0.7 * t * t).toFixed(2)})`;

  return (
    <div
      className={`countdown ${final ? 'final' : ''} ${done ? 'boom' : ''}`}
      style={{ ['--i' as string]: intensity.toFixed(3) }}
      onDoubleClick={() => document.documentElement.requestFullscreen?.()}
    >
      {final && <div className="countdown-flash" key={s} />}
      <Mark height={64} />
      {boomed ? (
        <div className="countdown-sike">
          {after[0]}
          <br />
          {after[1]}
        </div>
      ) : (
        <>
          <div className="countdown-label" style={{ color: t > 0.6 ? color : undefined }}>
            {label}
          </div>
          <div
            key={final ? s : 'steady'}
            className={`countdown-clock ${final ? 'tick' : ''}`}
            style={{ color: done ? '#fff' : color, textShadow: glow }}
          >
            {done ? '💥' : `${m}:${String(s).padStart(2, '0')}`}
          </div>
          {sub && <div className="countdown-sub">{sub}</div>}
        </>
      )}
    </div>
  );
}
