import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DESCRIPTION_MAX_WORDS,
  IDEAS_PER_GROUP,
  TITLE_MAX_CHARS,
  VOTE_KINDS,
  VOTE_META,
  countWords,
  voteWinners,
  type VoteKind,
} from '../../../shared/rules';
import type { MeState, PublicIdea, PublicState } from '../../../shared/types';
import { Brand, ConnectionBanner, IdeaDetail, Leaderboard, Modal, TimerView, WordCount } from '../components/ui';
import { CODE_KEY, connect, emitAck, joinGame, useStore } from '../lib/store';
import { stableShuffle } from '../lib/time';

export default function Play() {
  const { playerMode, pub, me, ideas, codeError } = useStore();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (code) {
      localStorage.setItem(CODE_KEY, code.toUpperCase());
      window.history.replaceState(null, '', import.meta.env.BASE_URL);
    }
    connect('player');
  }, []);

  let body;
  if (playerMode === 'connecting') body = <Center>Connecting…</Center>;
  else if (playerMode === 'needCode') body = <JoinForm askCode error={codeError} />;
  else if (playerMode === 'viewer') body = <JoinForm askCode={false} error={null} />;
  else if (!pub || !me) body = <Center>Loading…</Center>;
  else if (!me.groupNumber) body = <Waiting pub={pub} me={me} />;
  else body = <GroupGame pub={pub} me={me} ideas={ideas} />;

  return (
    <div className="phone">
      <ConnectionBanner />
      {body}
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Brand />
      <div className="center-msg">{children}</div>
    </>
  );
}

function JoinForm({ askCode, error }: { askCode: boolean; error: string | null }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(error);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || (askCode && !code.trim())) return;
    setPending(true);
    const res = await joinGame(name.trim(), askCode ? code : undefined);
    setPending(false);
    if (!res.ok) setErr(res.error);
  }
  return (
    <>
      <Brand />
      <form className="card stack" onSubmit={submit}>
        <h1>Join the game</h1>
        {askCode && (
          <>
            <p className="muted">Type the code on the big screen.</p>
            <input
              className="code-input"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="CODE"
              autoCapitalize="characters"
              autoComplete="off"
              maxLength={8}
            />
          </>
        )}
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          autoComplete="given-name"
          maxLength={40}
          autoFocus={!askCode}
        />
        {err && <p className="error">{err}</p>}
        <button className="btn btn-primary" type="submit" disabled={pending || !name.trim()}>
          {pending ? 'Joining…' : 'Join'}
        </button>
      </form>
    </>
  );
}

const dur = (ms: number) => (ms % 60000 === 0 ? `${ms / 60000} min` : `${Math.round(ms / 1000)} s`);

function Waiting({ pub, me }: { pub: PublicState; me: MeState }) {
  return (
    <>
      <Brand />
      <div className="card hero-card">
        <div className="label accent">You're in</div>
        <h1>{me.name}</h1>
        <p className="muted">
          Look for your name on the big screen. {pub.playerCount} {pub.playerCount === 1 ? 'person has' : 'people have'}{' '}
          joined. Teams of 4 get made when the game starts.
        </p>
      </div>
      <div className="card stack">
        <h3>How it works</h3>
        <ol className="howto">
          <li>
            <strong>Ideas ({dur(pub.durations.submitMs)}):</strong> your team writes {IDEAS_PER_GROUP} wacky startup ideas.
          </li>
          <li>
            <strong>Vote ({dur(pub.durations.voteMs)}):</strong> 🚀 good, 😐 okay or 💩 bad on every other team's idea.
          </li>
          <li>
            <strong>Superlatives:</strong> pick the idea that deserves each award.
          </li>
        </ol>
      </div>
    </>
  );
}

function GroupGame({ pub, me, ideas }: { pub: PublicState; me: MeState; ideas: PublicIdea[] }) {
  const header = (
    <Brand
      right={
        <div className="phone-head-right">
          <span className="group-badge">Team {me.groupNumber}</span>
        </div>
      }
    />
  );
  return (
    <>
      {header}
      {pub.phase !== 'lobby' && pub.phase !== 'finished' && (
        <div className="phone-timer">
          <TimerView timer={pub.timer} />
        </div>
      )}
      <main key={pub.phase + (pub.superlative?.index ?? '')} className="stack phase-enter">
          {pub.phase === 'lobby' && <Lobby me={me} pub={pub} />}
          {pub.phase === 'submit' && <PitchPhase pub={pub} me={me} ideas={ideas} />}
          {pub.phase === 'vote' && <VotePhase pub={pub} me={me} ideas={ideas} />}
          {pub.phase === 'superlatives' && <SuperlativePhase pub={pub} me={me} ideas={ideas} />}
          {pub.phase === 'finished' && <Recap pub={pub} ideas={ideas} />}
      </main>
    </>
  );
}

function Lobby({ me, pub }: { me: MeState; pub: PublicState }) {
  const joined = pub.groups.filter((g) => g.joined).length;
  return (
    <>
      <div className="card hero-card">
        <div className="label accent">You're in</div>
        <h1>Team {me.groupNumber}</h1>
        <ul className="members">
          {me.members.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      </div>
      <p className="muted center">
        Waiting for the organizers to start. {joined}/{pub.groups.length} groups are in.
      </p>
      <div className="card stack">
        <h3>How it works</h3>
        <ol className="howto">
          <li>
            <strong>Pitch (3 min):</strong> write {IDEAS_PER_GROUP} startup ideas, each a title plus up to{' '}
            {DESCRIPTION_MAX_WORDS} words.
          </li>
          <li>
            <strong>Vote (3 min):</strong> 🚀 good, 😐 okay or 💩 bad on every other group's idea. One vote each.
          </li>
          <li>
            <strong>Superlatives (1 min each):</strong> pick the idea that deserves each award.
          </li>
        </ol>
      </div>
    </>
  );
}

// ---------- Phase 1: pitch ----------

function PitchPhase({ pub, me, ideas }: { pub: PublicState; me: MeState; ideas: PublicIdea[] }) {
  const [open, setOpen] = useState<PublicIdea | null>(null);
  const closed = pub.locked;
  return (
    <>
      <div className="phase-head">
        <div className="label accent">Phase 1 · Pitch</div>
        <h1>Pitch {IDEAS_PER_GROUP} wacky ideas</h1>
        <p className="muted">
          Team {me.groupNumber}: {me.members.join(', ')}. Split them up: one idea each. A title is enough. Saves automatically.
        </p>
      </div>
      {closed && <div className="notice">Time's up! Voting starts in a moment.</div>}
      {Array.from({ length: IDEAS_PER_GROUP }, (_, slot) => (
        <IdeaForm key={slot} slot={slot} mine={me.ideas[slot]} disabled={closed} />
      ))}
      <section className="stack-sm">
        <h3 className="label">
          The board · {pub.ideaCount}/{pub.ideaTarget} ideas
        </h3>
        <ul className="idea-list">
          {ideas.map((i) => (
            <li key={i.id} onClick={() => setOpen(i)}>
              {i.title}
            </li>
          ))}
        </ul>
      </section>
      {open && (
        <Modal onClose={() => setOpen(null)}>
          <IdeaDetail idea={open} />
        </Modal>
      )}
    </>
  );
}

function IdeaForm({ slot, mine, disabled }: { slot: number; mine: MeState['ideas'][number]; disabled: boolean }) {
  const [title, setTitle] = useState(mine?.title ?? '');
  const [desc, setDesc] = useState(mine?.description ?? '');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>(mine ? 'saved' : 'idle');
  const [error, setError] = useState<string | null>(null);
  const saved = useRef({ title: mine?.title ?? '', desc: mine?.description ?? '' });
  const words = countWords(desc);
  const dirty = title.trim() !== saved.current.title || desc.trim() !== saved.current.desc;
  const valid = title.trim().length > 0 && words <= DESCRIPTION_MAX_WORDS;

  // Pick up the server copy (e.g. after a reconnect) unless there are unsaved local edits.
  useEffect(() => {
    if (!mine) return;
    if (!dirty) {
      setTitle(mine.title);
      setDesc(mine.description);
    }
    saved.current = { title: mine.title, desc: mine.description };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine?.title, mine?.description]);

  async function save() {
    if (!valid || disabled) return;
    setStatus('saving');
    const res = await emitAck('player:saveIdea', { slot, title, description: desc });
    if (res.ok) {
      saved.current = { title: title.trim(), desc: desc.trim() };
      setStatus('saved');
      setError(null);
    } else {
      setStatus('error');
      setError(res.error);
    }
  }

  // Autosave 1.5 s after typing stops.
  useEffect(() => {
    if (!dirty || !valid || disabled) return;
    const id = setTimeout(save, 1500);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, desc, disabled]);

  const statusText =
    status === 'saving'
      ? 'Saving…'
      : dirty
        ? valid
          ? 'Unsaved'
          : words > DESCRIPTION_MAX_WORDS
            ? 'Too long'
            : 'Needs a title'
        : mine
          ? 'Saved ✓'
          : 'Not started';

  return (
    <div className={`card stack-sm idea-form ${mine && !dirty ? 'is-saved' : ''}`}>
      <div className="row-between">
        <span className="label">Idea {slot + 1}</span>
        <span className={`save-status ${!dirty && mine ? 'ok' : ''}`}>{statusText}</span>
      </div>
      <input
        className="input"
        placeholder="Startup name or one-line idea"
        value={title}
        maxLength={TITLE_MAX_CHARS}
        disabled={disabled}
        onChange={(e) => setTitle(e.target.value)}
      />
      <textarea
        className="input"
        rows={2}
        placeholder="(Optional) one line on what it is"
        value={desc}
        disabled={disabled}
        onChange={(e) => setDesc(e.target.value)}
      />
      <div className="row-between">
        <WordCount words={words} />
        <button className="btn btn-small" disabled={!dirty || !valid || disabled || status === 'saving'} onClick={save}>
          Save
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

// ---------- Phase 2: vote ----------

function VotePhase({ pub, me, ideas }: { pub: PublicState; me: MeState; ideas: PublicIdea[] }) {
  const [tab, setTab] = useState<'vote' | 'board'>('vote');
  const [open, setOpen] = useState<PublicIdea | null>(null);
  const closed = pub.locked;
  const myIds = useMemo(() => new Set(me.ideas.filter(Boolean).map((i) => i!.id)), [me.ideas]);
  const order = useMemo(() => {
    const shuffled = stableShuffle(ideas, me.groupId);
    return [...shuffled.filter((i) => !myIds.has(i.id)), ...shuffled.filter((i) => myIds.has(i.id))];
  }, [ideas, me.groupId, myIds]);
  const eligible = order.filter((i) => !myIds.has(i.id));
  const done = eligible.filter((i) => me.votes[i.id]).length;
  const view = closed ? 'board' : tab;

  return (
    <>
      <div className="phase-head">
        <div className="label accent">Phase 2 · Vote</div>
        <h1>{closed ? 'Voting closed' : 'Rate every idea'}</h1>
        <p className="muted">
          {closed ? 'Eyes on the big screen.' : `🚀 good · 😐 okay · 💩 bad. One vote per idea, no take-backs.`}
        </p>
      </div>
      {!closed && (
        <div className="tabs">
          <button className={tab === 'vote' ? 'active' : ''} onClick={() => setTab('vote')}>
            Vote · {done}/{eligible.length}
          </button>
          <button className={tab === 'board' ? 'active' : ''} onClick={() => setTab('board')}>
            Live leaderboard
          </button>
        </div>
      )}
      {view === 'vote' ? (
        <ul className="vote-list">
          {order.map((idea) => (
            <VoteCard key={idea.id} idea={idea} mine={myIds.has(idea.id)} vote={me.votes[idea.id]} />
          ))}
          {!order.length && <p className="muted">No ideas were submitted.</p>}
        </ul>
      ) : (
        <Leaderboard ideas={ideas} tallies={pub.tallies} onSelect={setOpen} winnersOnTop={closed} />
      )}
      {open && (
        <Modal onClose={() => setOpen(null)}>
          <IdeaDetail idea={open} tally={pub.tallies?.[open.id]} />
        </Modal>
      )}
    </>
  );
}

function VoteCard({ idea, mine, vote }: { idea: PublicIdea; mine: boolean; vote?: VoteKind }) {
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState<VoteKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function cast(kind: VoteKind) {
    if (vote || pending) return;
    setPending(kind);
    setError(null);
    const res = await emitAck('player:vote', { ideaId: idea.id, kind });
    setPending(null);
    if (!res.ok) setError(res.error);
  }

  const chosen = vote ?? pending;
  return (
    <li className={`vote-card ${vote ? 'voted' : ''} ${mine ? 'mine' : ''}`}>
      <button className="vote-title" onClick={() => setExpanded((x) => !x)}>
        <span>{idea.title}</span>
        <span className="chev">{expanded ? '−' : '+'}</span>
      </button>
      {expanded && <p className="idea-desc">{idea.description}</p>}
      {mine ? (
        <div className="label muted">Your idea</div>
      ) : (
        <div className="vote-buttons">
          {VOTE_KINDS.map((k) => (
            <button
              key={k}
              className={`vote-btn ${chosen === k ? 'chosen' : ''} ${chosen && chosen !== k ? 'dim' : ''}`}
              disabled={Boolean(chosen)}
              onClick={() => cast(k)}
              aria-label={VOTE_META[k].label}
            >
              <span className="emoji">{VOTE_META[k].emoji}</span>
              <span className="vote-label">{VOTE_META[k].label}</span>
            </button>
          ))}
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </li>
  );
}

// ---------- Phase 3: superlatives ----------

function SuperlativePhase({ pub, me, ideas }: { pub: PublicState; me: MeState; ideas: PublicIdea[] }) {
  const sup = pub.superlative;
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const myIds = new Set(me.ideas.filter(Boolean).map((i) => i!.id));
  const byId = new Map(ideas.map((i) => [i.id, i]));

  useEffect(() => {
    setSelected(null);
    setError(null);
  }, [sup?.index]);

  if (!sup) return null;
  const myVote = me.superlativeVotes[String(sup.index)];

  async function lockIn() {
    if (!selected || !sup) return;
    setPending(true);
    const res = await emitAck('player:superlativeVote', { index: sup.index, ideaId: selected });
    setPending(false);
    if (!res.ok) setError(res.error);
  }

  const head = (
    <div className="phase-head">
      <div className="label accent">
        Superlative {sup.index + 1} of {sup.total}
      </div>
      <h1 className="superlative-text">{sup.text}</h1>
    </div>
  );

  if (sup.result) {
    return (
      <>
        {head}
        <SuperlativeResultCard result={sup.result} byId={byId} />
        <p className="muted center">{sup.index + 1 < sup.total ? 'Next superlative coming up…' : 'Final results coming up…'}</p>
      </>
    );
  }

  if (myVote) {
    return (
      <>
        {head}
        <div className="card stack-sm">
          <div className="label">Locked in</div>
          <h2>{byId.get(myVote)?.title ?? 'Your pick'}</h2>
          <p className="muted">
            {sup.votedCount}/{sup.eligibleCount} people have voted. Results when the timer hits zero.
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      {head}
      {pub.locked ? (
        <div className="notice">Time's up.</div>
      ) : (
        <p className="muted">Pick one idea, then lock it in.</p>
      )}
      <ul className="pick-list">
        {stableShuffle(ideas, me.groupId).map((i) => {
          const mine = myIds.has(i.id);
          return (
            <li key={i.id} className={`pick ${selected === i.id ? 'selected' : ''} ${mine ? 'mine' : ''}`}>
              <button className="pick-main" disabled={mine || pub.locked} onClick={() => setSelected(i.id)}>
                <span className="radio" />
                <span className="pick-title">
                  {i.title}
                  {mine && <span className="label muted"> · Yours</span>}
                </span>
              </button>
              <button className="pick-more" onClick={() => setExpanded(expanded === i.id ? null : i.id)}>
                {expanded === i.id ? '−' : 'i'}
              </button>
              {expanded === i.id && <p className="idea-desc">{i.description}</p>}
            </li>
          );
        })}
      </ul>
      {error && <p className="error">{error}</p>}
      <div className="sticky-bottom">
        <button className="btn btn-primary btn-block" disabled={!selected || pending || pub.locked} onClick={lockIn}>
          {pending ? 'Locking in…' : selected ? `Lock in “${byId.get(selected)?.title}”` : 'Pick an idea'}
        </button>
      </div>
    </>
  );
}

export function SuperlativeResultCard({
  result,
  byId,
  big,
}: {
  result: NonNullable<PublicState['superlative']>['result'] & object;
  byId: Map<string, PublicIdea>;
  big?: boolean;
}) {
  const max = result.top[0]?.votes ?? 0;
  if (!result.winnerIds.length) {
    return <div className="card">No votes for this one.</div>;
  }
  return (
    <div className={`card stack-sm result-card ${big ? 'result-big' : ''}`}>
      <div className="label accent">{result.winnerIds.length > 1 ? "It's a tie" : 'Winner'}</div>
      {result.winnerIds.map((id) => {
        const idea = byId.get(id);
        return (
          <div key={id}>
            <h2 className="winner-title">{idea?.title ?? 'Removed idea'}</h2>
            {idea?.authorNumber != null && <div className="muted">Team {idea.authorNumber}</div>}
          </div>
        );
      })}
      <ul className="result-bars">
        {result.top.map((t) => (
          <li key={t.ideaId}>
            <span className="result-name">{byId.get(t.ideaId)?.title ?? 'Removed idea'}</span>
            <span className="result-bar">
              <span style={{ width: `${max ? (t.votes / max) * 100 : 0}%` }} />
            </span>
            <span className="result-votes">{t.votes}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- Finished ----------

export function Recap({ pub, ideas, big }: { pub: PublicState; ideas: PublicIdea[]; big?: boolean }) {
  const byId = new Map(ideas.map((i) => [i.id, i]));
  const winners = voteWinners(ideas, pub.tallies);
  return (
    <div className={`stack recap ${big ? 'recap-big' : ''}`}>
      <div className="phase-head">
        <div className="label accent">That's a wrap</div>
        <h1>The results</h1>
      </div>
      <div className="card stack-sm">
        <div className="label">🚀 Top idea</div>
        {winners.length ? (
          winners.map((w) => (
            <div key={w.item.id}>
              <h2 className="winner-title">{w.item.title}</h2>
              <div className="muted">
                Team {w.item.authorNumber} · {w.score > 0 ? `+${w.score}` : w.score}
              </div>
            </div>
          ))
        ) : (
          <p className="muted">No votes.</p>
        )}
      </div>
      <div className="recap-grid">
        {pub.superlativeResults.map((r) => (
          <div key={r.index} className="card stack-sm">
            <div className="label">{r.text}</div>
            {r.winnerIds.length ? (
              r.winnerIds.map((id) => (
                <div key={id}>
                  <strong>{byId.get(id)?.title ?? 'Removed idea'}</strong>
                  <span className="muted"> · Team {byId.get(id)?.authorNumber}</span>
                </div>
              ))
            ) : (
              <span className="muted">No votes</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
