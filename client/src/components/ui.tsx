import { motion } from 'framer-motion';
import { useEffect, useState, type ReactNode } from 'react';
import { DESCRIPTION_MAX_WORDS, VOTE_META, VOTE_KINDS, rankIdeas, scoreOf, type Tally } from '../../../shared/rules';
import type { PublicIdea, Timer } from '../../../shared/types';
import { fmtClock, timerInfo, useNow } from '../lib/time';
import { useStore } from '../lib/store';

export function Mark({ height = 28 }: { height?: number }) {
  return <img src="/brand/300-mark-canvas.svg" alt="300" style={{ height }} className="mark" />;
}

export function Brand({ size = 'sm', right }: { size?: 'sm' | 'lg'; right?: ReactNode }) {
  return (
    <header className={`brand brand-${size}`}>
      <div className="brand-lockup">
        <Mark height={size === 'lg' ? 56 : 26} />
        <span className="brand-sub label">AI Hackathon · Idea Board</span>
      </div>
      {right}
    </header>
  );
}

export function TimerView({ timer, big = false }: { timer: Timer | null | undefined; big?: boolean }) {
  const { clockOffset } = useStore();
  const now = useNow(200);
  const { status, remainingMs, fraction } = timerInfo(timer, clockOffset, now);
  if (status === 'none') return null;
  const urgent = status === 'running' && remainingMs <= 10_000;
  return (
    <div className={`timer ${big ? 'timer-big' : ''} ${urgent ? 'urgent' : ''} timer-${status}`} aria-live="off">
      <span className="timer-clock">{status === 'done' ? "Time's up" : fmtClock(remainingMs)}</span>
      {status === 'paused' && <span className="timer-note label">Paused</span>}
      {status !== 'done' && (
        <span className="timer-bar">
          <span style={{ transform: `scaleX(${Math.max(0, Math.min(1, fraction))})` }} />
        </span>
      )}
    </div>
  );
}

export function ConnectionBanner() {
  const { connected } = useStore();
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (connected) {
      setShow(false);
      return;
    }
    const id = setTimeout(() => setShow(true), 1500);
    return () => clearTimeout(id);
  }, [connected]);
  if (!show) return null;
  return <div className="conn-banner">Reconnecting…</div>;
}

export function Modal({ onClose, children, wide }: { onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={`modal pop-in ${wide ? 'modal-wide' : ''}`} onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        {children}
      </div>
    </div>
  );
}

export function IdeaDetail({ idea, tally, big }: { idea: PublicIdea; tally?: Tally | null; big?: boolean }) {
  return (
    <div className={`idea-detail ${big ? 'idea-detail-big' : ''}`}>
      {idea.authorNumber != null && <div className="label accent">Group {idea.authorNumber}</div>}
      <h2>{idea.title}</h2>
      <p className="idea-desc">{idea.description}</p>
      {tally && <TallyChips tally={tally} big={big} />}
    </div>
  );
}

export function TallyChips({ tally, big }: { tally: Tally; big?: boolean }) {
  const score = scoreOf(tally);
  return (
    <div className={`tally ${big ? 'tally-big' : ''}`}>
      {VOTE_KINDS.map((k) => (
        <span key={k} className="tally-chip" title={VOTE_META[k].label}>
          <span className="emoji">{VOTE_META[k].emoji}</span>
          {tally[k]}
        </span>
      ))}
      <span className={`score ${score > 0 ? 'pos' : score < 0 ? 'neg' : ''}`}>
        {score > 0 ? `+${score}` : score}
      </span>
    </div>
  );
}

export function Leaderboard({
  ideas,
  tallies,
  onSelect,
  size = 'md',
  winnersOnTop,
}: {
  ideas: PublicIdea[];
  tallies: Record<string, Tally> | null;
  onSelect?: (idea: PublicIdea) => void;
  size?: 'md' | 'xl';
  winnersOnTop?: boolean;
}) {
  const ranked = rankIdeas(ideas, tallies);
  const twoCol = size === 'xl' && ranked.length > 10;
  const rows = twoCol ? Math.ceil(ranked.length / 2) : ranked.length;
  // Big screen: 8+ rows stretch to fill the screen exactly; fewer rows keep their natural height.
  const fill = size === 'xl' && rows >= 8;
  return (
    <ol
      className={`board board-${size} ${twoCol ? 'board-2col' : ''} ${fill ? 'board-fill' : ''}`}
      style={size === 'xl' ? { gridTemplateRows: `repeat(${rows}, ${fill ? 'minmax(0, 1fr)' : 'auto'})` } : undefined}
    >
      {ranked.map((r) => {
        const first = winnersOnTop && r.rank === 1 && r.tally.rocket + r.tally.meh + r.tally.poop > 0;
        return (
          <motion.li
            layout
            transition={{ type: 'spring', stiffness: 380, damping: 34 }}
            key={r.item.id}
            className={`board-row ${first ? 'first' : ''} ${r.rank <= 3 ? `top top-${r.rank}` : ''}`}
            onClick={onSelect ? () => onSelect(r.item) : undefined}
            role={onSelect ? 'button' : undefined}
          >
            <span className="board-rank">{r.rank}</span>
            <span className="board-title">
              {r.item.title}
              {r.item.authorNumber != null && <span className="board-author"> · Group {r.item.authorNumber}</span>}
            </span>
            <TallyChips tally={r.tally} />
          </motion.li>
        );
      })}
    </ol>
  );
}

export function WordCount({ words }: { words: number }) {
  const over = words > DESCRIPTION_MAX_WORDS;
  return (
    <span className={`wordcount ${over ? 'over' : words > DESCRIPTION_MAX_WORDS - 20 ? 'near' : ''}`}>
      {words}/{DESCRIPTION_MAX_WORDS} words
    </span>
  );
}
