import { useEffect, useState } from 'react';
import { Mark } from '../components/ui';

// Pre-game countdown for the projector (Sean, 2026-11-12): "Idea-a-thon starts in", ending at 7:45pm Boston time.
// Change the time with ?at=2026-11-12T19:45:00-05:00
const DEFAULT_END = '2026-11-12T19:45:00-05:00';

export default function Countdown() {
  const at = new URLSearchParams(window.location.search).get('at') ?? DEFAULT_END;
  const end = Date.parse(at);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  const left = Math.max(0, end - now);
  const m = Math.floor(left / 60000);
  const s = Math.floor((left % 60000) / 1000);
  const done = left === 0;
  return (
    <div className="countdown" onDoubleClick={() => document.documentElement.requestFullscreen?.()}>
      <Mark height={64} />
      <div className="countdown-label">{done ? 'Idea-a-thon' : 'Idea-a-thon starts in'}</div>
      <div className={`countdown-clock ${!done && left <= 60_000 ? 'urgent' : ''}`}>
        {done ? "Let's go!" : `${m}:${String(s).padStart(2, '0')}`}
      </div>
      <div className="countdown-sub">300massave.com/ideaathon · 7:45pm</div>
    </div>
  );
}
