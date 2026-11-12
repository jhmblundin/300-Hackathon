import confetti from 'canvas-confetti';
import { motion } from 'framer-motion';
import QRCode from 'qrcode';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PHASE_LABEL, voteWinners } from '../../../shared/rules';
import type { PublicIdea, PublicState } from '../../../shared/types';
import { AdminGate } from '../components/AdminGate';
import { ConnectionBanner, IdeaDetail, Leaderboard, Mark, Modal, TimerView } from '../components/ui';
import { adminAction, useStore } from '../lib/store';
import { Recap, SuperlativeResultCard } from './Play';

const BRAND_CONFETTI = ['#C8102E', '#F6F6F4', '#F14C66', '#9A9CA5'];

export default function Screen() {
  return (
    <AdminGate title="Sign in to open the big screen">
      <ScreenInner />
    </AdminGate>
  );
}

function ScreenInner() {
  const { pub, ideas, admin } = useStore();
  const [open, setOpen] = useState<PublicIdea | null>(null);
  const phaseKey = `${pub?.phase}:${pub?.superlative?.index ?? ''}`;
  // A description opened on the big screen closes itself when the game moves on.
  useEffect(() => setOpen(null), [phaseKey]);
  if (!pub || !admin) return <div className="screen center-msg">Loading…</div>;
  const spotlight = pub.spotlightIdeaId ? ideas.find((i) => i.id === pub.spotlightIdeaId) : null;
  const shown = spotlight ?? (open ? (ideas.find((i) => i.id === open.id) ?? open) : null);

  return (
    <div className="screen">
      <ConnectionBanner />
      <header className="screen-head">
        <div className="brand-lockup">
          <Mark height={48} />
          <span className="brand-sub label">AI Hackathon · Idea Board</span>
        </div>
        <div className="screen-phase label">{PHASE_LABEL[pub.phase]}</div>
        <div className="screen-head-right">
          {pub.phase !== 'lobby' && pub.phase !== 'setup' && pub.phase !== 'finished' && (
            <TimerView timer={pub.timer} big />
          )}
          <FullscreenButton />
        </div>
      </header>
      <main className="screen-body phase-enter" key={pub.phase + (pub.superlative?.index ?? '')}>
          {(pub.phase === 'setup' || pub.phase === 'lobby') && <ScreenLobby pub={pub} joinCode={admin.joinCode} />}
          {pub.phase === 'submit' && <ScreenSubmit pub={pub} ideas={ideas} onOpen={setOpen} />}
          {pub.phase === 'vote' && <ScreenVote pub={pub} ideas={ideas} onOpen={setOpen} />}
          {pub.phase === 'superlatives' && <ScreenSuperlative pub={pub} ideas={ideas} />}
          {pub.phase === 'finished' && <Recap pub={pub} ideas={ideas} big />}
      </main>
      {shown && (
        <Modal onClose={() => (spotlight ? void adminAction('spotlight', { ideaId: null }) : setOpen(null))} wide>
          <IdeaDetail idea={shown} tally={pub.tallies?.[shown.id]} big />
          {spotlight && <p className="label muted">Spotlighted from the admin console</p>}
        </Modal>
      )}
    </div>
  );
}

function FullscreenButton() {
  return (
    <button
      className="btn btn-ghost btn-small"
      onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen())}
      title="Full screen"
    >
      ⛶
    </button>
  );
}

export function JoinQr({ joinCode, size = 340 }: { joinCode: string; size?: number }) {
  const url = `${window.location.origin}/?code=${joinCode}`;
  const [svg, setSvg] = useState('');
  useEffect(() => {
    QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#1E2028', light: '#F6F6F4' } })
      .then(setSvg)
      .catch(() => setSvg(''));
  }, [url]);
  return (
    <div className="qr-wrap">
      <div className="qr" style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: svg }} />
      <div className="qr-caption">
        <div className="muted">{window.location.host}</div>
        <div className="join-code">{joinCode}</div>
      </div>
    </div>
  );
}

function ScreenLobby({ pub, joinCode }: { pub: PublicState; joinCode: string }) {
  const joined = pub.groups.filter((g) => g.joined).length;
  return (
    <div className="lobby-layout">
      <div className="lobby-left">
        <h1 className="display">Scan to join</h1>
        <p className="lead">One phone per group. Find your name, tap your group.</p>
        <JoinQr joinCode={joinCode} />
      </div>
      <div className="lobby-right">
        {pub.groups.length ? (
          <>
            <div className="row-between">
              <h2>Groups</h2>
              <span className="label">
                {joined}/{pub.groups.length} joined
              </span>
            </div>
            <div className="screen-groups">
              {pub.groups.map((g) => (
                <motion.div
                  key={g.id}
                  className={`screen-group ${g.joined ? 'joined' : ''}`}
                  animate={g.joined ? { scale: [1, 1.04, 1] } : {}}
                >
                  <div className="screen-group-num">
                    Group {g.number} {g.joined && <span className="check">✓</span>}
                  </div>
                  <div className="screen-group-members">{g.members.join(' · ')}</div>
                </motion.div>
              ))}
            </div>
          </>
        ) : (
          <div className="center-msg">Groups coming soon…</div>
        )}
      </div>
    </div>
  );
}

function ScreenSubmit({ pub, ideas, onOpen }: { pub: PublicState; ideas: PublicIdea[]; onOpen: (i: PublicIdea) => void }) {
  return (
    <div className="stack">
      <div className="row-between">
        <h1 className="display-sm">{pub.locked ? "Time's up. Pens down!" : 'Pitch two ideas per group'}</h1>
        <span className="big-count">
          {pub.ideaCount}
          <span className="muted">/{pub.ideaTarget} ideas</span>
        </span>
      </div>
      <ul className="title-wall">
        {ideas.map((i) => (
          <li key={i.id} className="pop-in" onClick={() => onOpen(i)}>
            {i.title}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ScreenVote({ pub, ideas, onOpen }: { pub: PublicState; ideas: PublicIdea[]; onOpen: (i: PublicIdea) => void }) {
  const winners = pub.locked ? voteWinners(ideas, pub.tallies) : [];
  const fired = useRef(false);
  useEffect(() => {
    if (pub.locked && winners.length && !fired.current) {
      fired.current = true;
      confetti({ particleCount: 220, spread: 100, origin: { y: 0.3 }, colors: BRAND_CONFETTI });
    }
  }, [pub.locked, winners.length]);
  return (
    <div className="screen-fill">
      <div className="row-between">
        <h1 className="display-sm">{pub.locked ? 'Voting closed' : 'Live leaderboard'}</h1>
        <span className="big-count">
          {pub.votesCast}
          <span className="muted">/{pub.votesPossible} votes</span>
        </span>
      </div>
      {winners.length > 0 && (
        <button className="winner-banner pop-in" onClick={() => onOpen(winners[0].item)}>
          <span className="label">{winners.length > 1 ? 'Tied for #1' : '🏆 Top idea'}</span>
          <span className="winner-title">{winners.map((w) => w.item.title).join('  ·  ')}</span>
          <span className="muted">
            {winners.map((w) => `Group ${w.item.authorNumber}`).join(' · ')} · tap to read it
          </span>
        </button>
      )}
      <Leaderboard ideas={ideas} tallies={pub.tallies} onSelect={onOpen} size="xl" winnersOnTop={pub.locked} />
    </div>
  );
}

function ScreenSuperlative({ pub, ideas }: { pub: PublicState; ideas: PublicIdea[] }) {
  const sup = pub.superlative;
  const byId = useMemo(() => new Map(ideas.map((i) => [i.id, i])), [ideas]);
  const firedFor = useRef<number | null>(null);
  useEffect(() => {
    if (sup?.result && sup.result.winnerIds.length && firedFor.current !== sup.index) {
      firedFor.current = sup.index;
      confetti({ particleCount: 180, spread: 90, origin: { y: 0.35 }, colors: BRAND_CONFETTI });
    }
  }, [sup?.result, sup?.index]);
  if (!sup) return null;
  return (
    <div className="superlative-screen">
      <div className="label accent">
        Superlative {sup.index + 1} of {sup.total}
      </div>
      <h1 className="superlative-display">{sup.text}</h1>
      {sup.result ? (
        <div className="superlative-result pop-in">
          <SuperlativeResultCard result={sup.result} byId={byId} big />
        </div>
      ) : (
        <div className="superlative-waiting">
          <div className="big-count">
            {sup.votedCount}
            <span className="muted">/{sup.eligibleCount} groups voted</span>
          </div>
          <p className="lead muted">Vote on your phone. Results when the timer hits zero.</p>
        </div>
      )}
    </div>
  );
}
