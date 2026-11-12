import { useEffect, useState } from 'react';
import { PHASE_LABEL, SUPERLATIVES, VOTE_META, groupSizes } from '../../../shared/rules';
import type { AdminState, PublicState } from '../../../shared/types';
import { AdminGate, logout, useAdminName } from '../components/AdminGate';
import { ConnectionBanner, Mark, TallyChips, TimerView } from '../components/ui';
import { adminAction, useStore } from '../lib/store';
import { JoinQr } from './Screen';

type Tab = 'game' | 'groups' | 'ideas';

export default function Admin() {
  return (
    <AdminGate>
      <AdminInner />
    </AdminGate>
  );
}

function AdminInner() {
  const name = useAdminName();
  const { pub, admin } = useStore();
  const [tab, setTab] = useState<Tab>('game');
  const [flash, setFlash] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(id);
  }, [flash]);

  async function act(type: string, extra: object = {}, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return false;
    const res = await adminAction(type, extra);
    if (!res.ok) setFlash({ kind: 'error', text: res.error });
    return res.ok;
  }

  return (
    <div className="admin">
      <ConnectionBanner />
      <header className="admin-head">
        <div className="brand-lockup">
          <Mark height={30} />
          <span className="brand-sub label">Idea Board · Admin</span>
        </div>
        <nav className="tabs admin-tabs">
          {(['game', 'groups', 'ideas'] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {t === 'game' ? 'Game' : t === 'groups' ? 'Generate groups' : 'Ideas'}
            </button>
          ))}
        </nav>
        <div className="admin-head-right">
          <a className="btn btn-small" href={`${import.meta.env.BASE_URL}presentation`} target="_blank" rel="noreferrer">
            Open big screen ↗
          </a>
          <span className="muted">{name}</span>
          <button className="btn btn-ghost btn-small" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>
      {flash && <div className={`flash flash-${flash.kind}`}>{flash.text}</div>}
      {!pub || !admin ? (
        <div className="center-msg">Loading…</div>
      ) : tab === 'game' ? (
        <GameTab pub={pub} admin={admin} act={act} />
      ) : tab === 'groups' ? (
        <GroupsTab pub={pub} admin={admin} act={act} goGame={() => setTab('game')} />
      ) : (
        <IdeasTab pub={pub} admin={admin} act={act} />
      )}
    </div>
  );
}

type Act = (type: string, extra?: object, confirmText?: string) => Promise<boolean>;

function nextLabel(pub: PublicState): string | null {
  if (pub.phase === 'lobby') return 'Start the game';
  if (!pub.locked) return null;
  if (pub.phase === 'submit') return 'Start voting →';
  if (pub.phase === 'vote') return 'Start superlatives →';
  if (pub.phase === 'superlatives') {
    const i = pub.superlative?.index ?? 0;
    return i < SUPERLATIVES.length - 1 ? `Next superlative (${i + 2}/${SUPERLATIVES.length}) →` : 'Finish: show the recap →';
  }
  return null;
}

function GameTab({ pub, admin, act }: { pub: PublicState; admin: AdminState; act: Act }) {
  const joined = admin.groups.filter((g) => g.joined).length;
  const timed = pub.phase === 'submit' || pub.phase === 'vote' || pub.phase === 'superlatives';
  const running = pub.timer?.endsAt != null;
  const paused = pub.timer?.pausedRemainingMs != null;
  const label = nextLabel(pub);
  const steps: { key: string; label: string; active: boolean; done: boolean }[] = [];
  const order = ['lobby', 'submit', 'vote', 'superlatives', 'finished'] as const;
  const at = order.indexOf(pub.phase as (typeof order)[number]);
  order.forEach((p, i) =>
    steps.push({
      key: p,
      label: p === 'superlatives' && pub.superlative ? `Superlatives ${pub.superlative.index + 1}/6` : PHASE_LABEL[p],
      active: i === at,
      done: at > i,
    }),
  );

  return (
    <div className="admin-body">
      <ol className="stepper">
        {steps.map((s) => (
          <li key={s.key} className={`${s.active ? 'active' : ''} ${s.done ? 'done' : ''}`}>
            {s.label}
          </li>
        ))}
      </ol>

      {pub.phase === 'setup' && (
        <div className="card">
          Start on the <strong>Generate groups</strong> tab: paste the participant list, then generate groups.
        </div>
      )}

      <div className="admin-grid">
        <section className="card stack">
          <div className="label">{PHASE_LABEL[pub.phase]}</div>
          {pub.phase === 'superlatives' && pub.superlative && <h2>{pub.superlative.text}</h2>}
          {pub.phase === 'finished' && (
            <p className="muted">Game over. The big screen shows the recap. To play again, use Danger zone → Restart game.</p>
          )}
          {pub.phase === 'lobby' && (
            <p className="muted">
              {joined}/{admin.groups.length} groups have joined. Put the big screen up so people can scan the QR code.
            </p>
          )}
          {timed && <TimerView timer={pub.timer} big />}
          <div className="btn-row">
            {pub.phase === 'lobby' && (
              <button
                className="btn btn-primary btn-lg"
                onClick={() =>
                  act(
                    'start',
                    {},
                    joined < admin.groups.length
                      ? `Only ${joined}/${admin.groups.length} groups have joined. Start anyway? (Late groups can still join.)`
                      : undefined,
                  )
                }
              >
                Start the game
              </button>
            )}
            {timed && !pub.locked && (
              <button
                className="btn btn-primary btn-lg"
                onClick={() => act('endTimer', {}, 'End this phase now? Inputs close immediately.')}
              >
                End timer now
              </button>
            )}
            {timed && pub.locked && label && (
              <button className="btn btn-primary btn-lg" onClick={() => act('next')}>
                {label}
              </button>
            )}
          </div>
          {timed && (
            <div className="btn-row">
              {running && (
                <button className="btn" onClick={() => act('pause')}>
                  Pause
                </button>
              )}
              {paused && (
                <button className="btn" onClick={() => act('resume')}>
                  Resume
                </button>
              )}
              <button className="btn" onClick={() => act('addTime', { seconds: 30 })}>
                +30 s
              </button>
              <button className="btn" onClick={() => act('addTime', { seconds: 60 })}>
                +1 min
              </button>
            </div>
          )}
          {timed && pub.locked && (
            <p className="muted small">Time's up: phones are locked. "+30 s" reopens this phase.</p>
          )}
        </section>

        <section className="card stack-sm">
          <div className="label">Live status</div>
          <Stat label="Groups joined" value={`${joined}/${admin.groups.length}`} />
          <Stat label="Ideas submitted" value={`${pub.ideaCount}/${pub.ideaTarget}`} />
          {(pub.phase === 'vote' || pub.phase === 'superlatives' || pub.phase === 'finished') && (
            <Stat label="Emoji votes cast" value={`${pub.votesCast}/${pub.votesPossible}`} />
          )}
          {pub.superlative && (
            <Stat label="Groups voted (this superlative)" value={`${pub.superlative.votedCount}/${pub.superlative.eligibleCount}`} />
          )}
          <div className="chip-grid">
            {admin.groups.map((g) => (
              <span
                key={g.id}
                className={`chip ${g.joined ? 'on' : ''}`}
                title={`${g.members.join(', ')}\nideas ${g.ideaCount} · votes ${g.voteCount}`}
              >
                G{g.number}
                {pub.phase === 'submit' && <small> {g.ideaCount}/2</small>}
                {pub.phase === 'vote' && <small> {g.voteCount}</small>}
                {pub.phase === 'superlatives' && g.votedSuperlative && <small> ✓</small>}
              </span>
            ))}
          </div>
        </section>
      </div>

      <details className="card danger">
        <summary>Danger zone</summary>
        <div className="btn-row">
          <button
            className="btn"
            onClick={() =>
              act('resetGame', { scope: 'game' }, 'Restart the game? Deletes all ideas and votes. Groups and joined phones stay.')
            }
          >
            Restart game (keep groups)
          </button>
          <button
            className="btn btn-danger"
            onClick={() => act('resetGame', { scope: 'all' }, 'Reset EVERYTHING? Deletes groups, ideas, votes and the join code.')}
          >
            Reset everything
          </button>
        </div>
      </details>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="muted">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function GroupsTab({ pub, admin, act, goGame }: { pub: PublicState; admin: AdminState; act: Act; goGame: () => void }) {
  const [text, setText] = useState(admin.participants.join('\n'));
  const started = pub.phase !== 'setup' && pub.phase !== 'lobby';
  // Same normalization as the server (tabs/extra spaces collapse), so a pasted list reads as saved.
  const normalized = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const lines = normalized.length;
  const changedList = normalized.join('\n') !== admin.participants.join('\n');
  const sizes = groupSizes(admin.participants.length);
  const fours = sizes.filter((s) => s === 4).length;
  const others = sizes.filter((s) => s !== 4);

  async function generate() {
    const again = admin.groups.length > 0;
    const ok = await act(
      'generateGroups',
      {},
      again ? 'Reshuffle into brand-new groups? Phones that already joined will have to pick their new group.' : undefined,
    );
    if (ok && !again) goGame();
  }

  return (
    <div className="admin-body admin-grid">
      <section className="card stack">
        <div className="row-between">
          <h2>Participants</h2>
          <span className="label">{admin.participants.length} saved</span>
        </div>
        <p className="muted small">
          One person per line. Paste straight from a spreadsheet ("First⇥Last" is fine). Kept on the server only,
          never in the repo.
        </p>
        <textarea
          className="input mono"
          rows={16}
          value={text}
          disabled={started}
          onChange={(e) => setText(e.target.value)}
          placeholder={'Ada Lovelace\nAlan Turing\n…'}
        />
        <div className="btn-row">
          <button
            className="btn"
            disabled={started || !changedList}
            onClick={() =>
              act(
                'setParticipants',
                { text },
                admin.groups.length ? 'Saving a new list clears the current groups. Continue?' : undefined,
              )
            }
          >
            Save list ({lines} {lines === 1 ? 'name' : 'names'})
          </button>
        </div>
      </section>

      <section className="card stack">
        <h2>Generate groups</h2>
        {admin.participants.length > 0 && (
          <p className="muted">
            {admin.participants.length} people → {sizes.length} groups: {fours} of 4
            {others.length ? ` + ${others.length} of ${[...new Set(others)].join(' or ')}` : ''}.
          </p>
        )}
        <button
          className="btn btn-primary btn-lg"
          disabled={started || admin.participants.length < 2 || changedList}
          onClick={generate}
        >
          {admin.groups.length ? 'Reshuffle groups' : 'Generate random groups'}
        </button>
        {changedList && <p className="small muted">Save the list first.</p>}
        {started && <p className="small muted">The game has started. Restart it (Game → Danger zone) to reshuffle.</p>}

        {admin.groups.length > 0 && (
          <>
            <div className="row-between">
              <div>
                <div className="label">Join code</div>
                <div className="join-code">{admin.joinCode}</div>
              </div>
              <button
                className="btn btn-small"
                onClick={() => act('rotateCode', {}, 'Make a new join code? Phones that already joined stay joined.')}
              >
                New code
              </button>
            </div>
            <JoinQr joinCode={admin.joinCode} size={160} />
            <div className="admin-groups">
              {admin.groups.map((g) => (
                <div key={g.id} className={`admin-group ${g.joined ? 'joined' : ''}`}>
                  <div className="row-between">
                    <strong>Group {g.number}</strong>
                    {g.joined ? (
                      <button
                        className="btn btn-ghost btn-small"
                        onClick={() =>
                          act('releaseClaim', { groupId: g.id }, `Release Group ${g.number}'s phone so another phone can join?`)
                        }
                      >
                        Release phone
                      </button>
                    ) : (
                      <span className="label muted">Not joined</span>
                    )}
                  </div>
                  <div className="small">{g.members.join(', ')}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function IdeasTab({ pub, admin, act }: { pub: PublicState; admin: AdminState; act: Act }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="admin-body stack">
      <div className="row-between">
        <h2>
          Ideas ({admin.ideas.length}/{pub.ideaTarget})
        </h2>
        {pub.spotlightIdeaId && (
          <button className="btn" onClick={() => act('spotlight', { ideaId: null })}>
            Clear spotlight
          </button>
        )}
      </div>
      <p className="muted small">
        Only admins see which group wrote what. "Spotlight" pops an idea up full-size on the big screen. Score = {VOTE_META.rocket.emoji} −{' '}
        {VOTE_META.poop.emoji}.
      </p>
      <table className="ideas-table">
        <thead>
          <tr>
            <th>Group</th>
            <th>Idea</th>
            <th>Votes</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {admin.ideas.map((i) => (
            <tr key={i.id} className={pub.spotlightIdeaId === i.id ? 'spot' : ''}>
              <td>G{i.groupNumber}</td>
              <td>
                <button className="link" onClick={() => setOpen(open === i.id ? null : i.id)}>
                  {i.title}
                </button>
                {open === i.id && <p className="idea-desc small">{i.description}</p>}
              </td>
              <td>
                <TallyChips tally={i.tally} />
              </td>
              <td className="nowrap">
                <button className="btn btn-small" onClick={() => act('spotlight', { ideaId: i.id })}>
                  Spotlight
                </button>{' '}
                <button
                  className="btn btn-small btn-danger"
                  onClick={() => act('removeIdea', { ideaId: i.id }, `Remove "${i.title}" and its votes? This can't be undone.`)}
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
          {!admin.ideas.length && (
            <tr>
              <td colSpan={4} className="muted">
                No ideas yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
