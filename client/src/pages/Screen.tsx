import confetti from 'canvas-confetti';
import { motion } from 'framer-motion';
import QRCode from 'qrcode';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PHASE_LABEL, SUPERLATIVES, voteWinners } from '../../../shared/rules';
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
          {(pub.phase === 'setup' || pub.phase === 'lobby') && <ScreenLobby pub={pub} joinCode={admin.joinCode} names={admin.players} />}
          {pub.phase === 'submit' && <ScreenSubmit pub={pub} ideas={ideas} onOpen={setOpen} />}
          {pub.phase === 'vote' && <ScreenVote pub={pub} ideas={ideas} onOpen={setOpen} />}
          {pub.phase === 'superlatives' && <ScreenSuperlative pub={pub} ideas={ideas} />}
          {pub.phase === 'finished' && <Recap pub={pub} ideas={ideas} big />}
      </main>
      <Controls pub={pub} />
      {shown && (
        <Modal onClose={() => (spotlight ? void adminAction('spotlight', { ideaId: null }) : setOpen(null))} wide>
          <IdeaDetail idea={shown} tally={pub.tallies?.[shown.id]} big />
          {spotlight && <p className="label muted">Spotlighted from the admin console</p>}
        </Modal>
      )}
    </div>
  );
}

/** The host's buttons, on the same screen that's up on the TV (Sean, 2026-11-12). */
function Controls({ pub }: { pub: PublicState }) {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function act(type: string, extra: object = {}, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    const r = await adminAction(type, extra);
    setBusy(false);
    setErr(r.ok ? null : r.error);
  }
  const timed = pub.phase === 'submit' || pub.phase === 'vote' || pub.phase === 'superlatives';
  const running = pub.timer?.endsAt != null;
  const paused = pub.timer?.pausedRemainingMs != null;
  let main: { label: string; run: () => void } | null = null;
  if (pub.phase === 'setup') main = { label: 'Start game', run: () => act('openLobby') };
  else if (pub.phase === 'lobby')
    main = {
      label: pub.playerCount ? `Start the game · ${pub.playerCount} in →` : 'Waiting for players…',
      run: () => pub.playerCount && act('start'),
    };
  else if (timed && pub.locked) {
    const i = pub.superlative?.index ?? 0;
    const label =
      pub.phase === 'submit'
        ? 'Start voting →'
        : pub.phase === 'vote'
          ? 'Start superlatives →'
          : i < SUPERLATIVES.length - 1
            ? `Next superlative (${i + 2}/${SUPERLATIVES.length}) →`
            : 'Show the recap →';
    main = { label, run: () => act('next') };
  } else if (timed) main = { label: 'Next phase →', run: () => act('endTimer').then(() => act('next')) };
  else if (pub.phase === 'finished')
    main = { label: 'New game', run: () => act('openLobby', {}, 'Start a new game? Everyone joins again.') };
  return (
    <div className="host-bar">
      {err && <span className="error">{err}</span>}
      {timed && !pub.locked && (
        <>
          <button className="btn btn-ghost btn-small" onClick={() => act(paused ? 'resume' : 'pause')} disabled={!running && !paused}>
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button className="btn btn-ghost btn-small" onClick={() => act('addTime', { seconds: 30 })}>
            +30 s
          </button>
        </>
      )}
      {pub.phase !== 'setup' && pub.phase !== 'finished' && (
        <button
          className="btn btn-ghost btn-small"
          onClick={() => act('openLobby', {}, 'Throw away this game and open a new waiting room? Everyone joins again.')}
        >
          Restart
        </button>
      )}
      {main && (
        <button className="btn btn-primary host-main" disabled={busy || (pub.phase === 'lobby' && !pub.playerCount)} onClick={main.run}>
          {main.label}
        </button>
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
  const url = `${window.location.origin}${import.meta.env.BASE_URL}?code=${joinCode}`;
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
        <div className="muted">{window.location.host}{import.meta.env.BASE_URL.replace(/\/$/, '')}</div>
        <div className="join-code">{joinCode}</div>
      </div>
    </div>
  );
}

function ScreenLobby({ pub, joinCode, names }: { pub: PublicState; joinCode: string; names: string[] }) {
  if (pub.phase === 'setup') {
    return (
      <div className="center-msg">
        <h1 className="display">Idea Board</h1>
        <p className="lead muted">Press Start game to open the waiting room.</p>
      </div>
    );
  }
  return (
    <div className="lobby-layout">
      <div className="lobby-left">
        <h1 className="display">Scan to join</h1>
        <p className="lead">Or go to the link and type the code.</p>
        <JoinQr joinCode={joinCode} />
      </div>
      <div className="lobby-right">
        <div className="row-between">
          <h2>Waiting room</h2>
          <span className="big-count">
            {names.length}
            <span className="muted"> joined</span>
          </span>
        </div>
        {names.length ? (
          <div className="name-cloud">
            {names.map((n, i) => (
              <motion.span key={i} className="name-chip" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
                {n}
              </motion.span>
            ))}
          </div>
        ) : (
          <div className="center-msg muted">Names show up here as people join…</div>
        )}
        {pub.groups.length > 0 && <p className="muted">Teams are made. Late joiners go to the smallest team.</p>}
      </div>
    </div>
  );
}

function ScreenSubmit({ pub, ideas, onOpen }: { pub: PublicState; ideas: PublicIdea[]; onOpen: (i: PublicIdea) => void }) {
  return (
    <div className="stack">
      <div className="row-between">
        <h1 className="display-sm">{pub.locked ? "Time's up. Pens down!" : 'Teams: pitch 3 wacky ideas'}</h1>
        <span className="big-count">
          {pub.ideaCount}
          <span className="muted">/{pub.ideaTarget} ideas</span>
        </span>
      </div>
      <div className="team-grid">
        {pub.groups.map((g) => (
          <div key={g.id} className="team-card">
            <b>Team {g.number}</b>
            <span>{g.members.join(' · ')}</span>
          </div>
        ))}
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
            {winners.map((w) => `Team ${w.item.authorNumber}`).join(' · ')} · tap to read it
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
            <span className="muted">/{sup.eligibleCount} people voted</span>
          </div>
          <p className="lead muted">Vote on your phone. Results when the timer hits zero.</p>
        </div>
      )}
    </div>
  );
}
