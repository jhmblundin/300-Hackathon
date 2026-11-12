import { motion } from 'framer-motion';
import { useEffect, useState, type ReactNode } from 'react';
import { DESCRIPTION_MAX_WORDS, VOTE_META, VOTE_KINDS, rankIdeas, scoreOf, totalVotes, type Tally, type VoteKind } from '../../../shared/rules';

/** Short emoji for chips and buttons (the 10-poop rating is too wide otherwise). */
export const shortEmoji = (k: VoteKind) => (k === 'megapoop' ? '💩×10' : VOTE_META[k].emoji);
import type { PublicIdea, Timer } from '../../../shared/types';
import { fmtClock, timerInfo, useNow } from '../lib/time';
import { useStore } from '../lib/store';

export function Mark({ height = 28 }: { height?: number }) {
  return <img src={`${import.meta.env.BASE_URL}brand/300-mark-canvas.svg`} alt="300" style={{ height }} className="mark" />;
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
      {idea.authorNumber != null && <div className="label accent">Team {idea.authorNumber}</div>}
      <h2>{idea.title}</h2>
      <p className="idea-desc">{idea.description}</p>
      {tally && <TallyChips tally={tally} big={big} />}
    </div>
  );
}

export function TallyChips({ tally, big, compact }: { tally: Tally; big?: boolean; compact?: boolean }) {
  const score = scoreOf(tally);
  const kinds = compact ? (['star', 'rocket', 'megapoop'] as VoteKind[]) : VOTE_KINDS;
  return (
    <div className={`tally ${big ? 'tally-big' : ''}`}>
      {kinds.filter((k) => tally[k] > 0).map((k) => (
        <span key={k} className={`tally-chip chip-${k}`} title={VOTE_META[k].label}>
          <span className="emoji">{k === 'megapoop' ? <>💩<sup>×10</sup></> : VOTE_META[k].emoji}</span>
          <b className="chip-n">{tally[k]}</b>
        </span>
      ))}
      <span key={score} className={`score score-pop ${score > 0 ? 'pos' : score < 0 ? 'neg' : ''}`}>
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
  // The big screen shows the top 12, big enough to read from the back of the room.
  const all = rankIdeas(ideas, tallies);
  const ranked = size === 'xl' ? all.slice(0, winnersOnTop ? 8 : 12) : all;
  const twoCol = false;
  const rows = twoCol ? Math.ceil(ranked.length / 2) : ranked.length;
  // Big screen: 8+ rows stretch to fill the screen exactly; fewer rows keep their natural height.
  const fill = size === 'xl' && rows >= 8;
  return (
    <ol
      className={`board board-${size} ${twoCol ? 'board-2col' : ''} ${fill ? 'board-fill' : ''}`}
      style={size === 'xl' ? { gridTemplateRows: `repeat(${rows}, ${fill ? 'minmax(0, 1fr)' : 'auto'})` } : undefined}
    >
      {ranked.map((r) => {
        const first = winnersOnTop && r.rank === 1 && totalVotes(r.tally) > 0;
        return (
          <motion.li
            layout
            transition={{ type: 'spring', stiffness: 380, damping: 34 }}
            key={r.item.id}
            className={`board-row ${first ? 'first' : ''} ${r.rank <= 3 ? `top top-${r.rank}` : ''}`}
            onClick={onSelect ? () => onSelect(r.item) : undefined}
            role={onSelect ? 'button' : undefined}
          >
            <span className="board-rank">{r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : r.rank}</span>
            <span className="board-title">
              {r.item.title}
              {r.item.authorNumber != null && <span className="board-author"> · Team {r.item.authorNumber}</span>}
            </span>
            <TallyChips tally={r.tally} compact />
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

/** Funniest-idea leaderboard: one pick per person, changeable while voting is open. */
export function FunnyBoard({ ideas, funny, size = 'md' }: { ideas: PublicIdea[]; funny: Record<string, number> | null; size?: 'md' | 'xl' }) {
  const rows = ideas
    .map((i) => ({ i, n: funny?.[i.id] ?? 0 }))
    .filter((r) => r.n > 0)
    .sort((a, b) => b.n - a.n || a.i.createdAt - b.i.createdAt)
    .slice(0, 8);
  return (
    <div className={`funny funny-${size}`}>
      <div className="funny-head">😂 Funniest</div>
      {rows.length ? (
        <ol className="funny-list">
          {rows.map((r, idx) => (
            <motion.li layout key={r.i.id} transition={{ type: 'spring', stiffness: 380, damping: 34 }} className={idx === 0 ? 'lead' : ''}>
              <span className="funny-title">{r.i.title}</span>
              <span key={r.n} className="funny-n score-pop">😂 {r.n}</span>
            </motion.li>
          ))}
        </ol>
      ) : (
        <p className="muted">Tap 😂 on the idea that made you laugh.</p>
      )}
    </div>
  );
}
