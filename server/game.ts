// The game engine. Pure state + rules; no sockets, no I/O. The server wraps it.
// Every input is treated as untrusted: phase, ownership and limits are checked here.

import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import {
  DESCRIPTION_MAX_CHARS,
  DESCRIPTION_MAX_WORDS,
  IDEAS_PER_GROUP,
  SUPERLATIVES,
  TITLE_MAX_CHARS,
  VOTE_KINDS,
  countWords,
  emptyTally,
  groupSizes,
  voteWinners,
  type Tally,
  type VoteKind,
} from '../shared/rules';
import type {
  Ack,
  AdminState,
  GameState,
  MeState,
  Phase,
  PublicIdea,
  PublicState,
  SuperlativeResult,
  Timer,
} from '../shared/types';

export interface GameConfig {
  submitMs: number;
  voteMs: number;
  superlativeMs: number;
}

export const BAD_CODE = "That code doesn't match. Check the code on the big screen.";
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I
const MAX_PARTICIPANTS = 400;
const MAX_NAME_CHARS = 80;

const ok = <T extends object>(extra?: T): Ack<T> => ({ ok: true, ...(extra as T) });
const fail = (error: string): Ack<never> => ({ ok: false, error });

export const newId = (prefix: string) => `${prefix}_${randomBytes(6).toString('base64url')}`;
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function makeJoinCode(): string {
  let s = '';
  for (let i = 0; i < 5; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s;
}

export function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Fisher-Yates with a cryptographic RNG. */
export function shuffle<T>(items: readonly T[]): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** One name per line. Tabs (from a spreadsheet: "First<TAB>Last") become spaces. */
export function parseParticipants(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_CHARS))
    .filter(Boolean)
    .slice(0, MAX_PARTICIPANTS);
}

export function initialState(): GameState {
  return {
    schemaVersion: 1,
    participants: [],
    groups: [],
    joinCode: makeJoinCode(),
    claims: {},
    players: {},
    phase: 'setup',
    locked: false,
    timer: null,
    ideas: [],
    votes: {},
    superlativeIndex: -1,
    superlativeVotes: {},
    spotlightIdeaId: null,
    startedAt: null,
  };
}

const cleanTitle = (s: string) => s.replace(/\s+/g, ' ').trim();
const cleanDescription = (s: string) =>
  s
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

export class Game {
  state: GameState;

  constructor(
    public cfg: GameConfig,
    saved?: GameState | null,
    private clock: () => number = Date.now,
  ) {
    this.state = saved && saved.schemaVersion === 1 ? { ...initialState(), ...saved } : initialState();
    this.state.players ??= {};
  }

  private now() {
    return this.clock();
  }

  // ---------- lookups ----------

  group(groupId: string) {
    return this.state.groups.find((g) => g.id === groupId);
  }

  idea(ideaId: string) {
    return this.state.ideas.find((i) => i.id === ideaId);
  }

  joinedGroupIds(): Set<string> {
    return new Set(this.state.groups.filter((g) => g.memberIds.length).map((g) => g.id));
  }

  players(): Record<string, { tokenHash: string; claimedAt: number }> {
    return (this.state.players ??= {});
  }

  /** The team a player is on, once teams are made. */
  playerGroup(playerId: string) {
    return this.state.groups.find((g) => g.memberIds.includes(playerId));
  }

  playerForToken(token: string): string | null {
    if (!token) return null;
    const h = hashToken(token);
    for (const [pid, c] of Object.entries(this.players())) if (c.tokenHash === h) return pid;
    return null;
  }

  /** Players on a team (they can vote). */
  teamedPlayerIds(): string[] {
    return this.state.groups.flatMap((g) => g.memberIds).filter((id) => this.players()[id]);
  }

  checkCode(code: string): boolean {
    const a = Buffer.from(normalizeCode(code));
    const b = Buffer.from(this.state.joinCode);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  groupForToken(token: string): string | null {
    if (!token) return null;
    const h = hashToken(token);
    for (const [groupId, claim] of Object.entries(this.state.claims)) {
      if (claim.tokenHash === h && this.group(groupId)) return groupId;
    }
    return null;
  }

  tallies(): Record<string, Tally> {
    const t: Record<string, Tally> = {};
    for (const idea of this.state.ideas) t[idea.id] = emptyTally();
    for (const votes of Object.values(this.state.votes)) {
      for (const [ideaId, kind] of Object.entries(votes)) {
        if (t[ideaId]) t[ideaId][kind]++;
      }
    }
    return t;
  }

  superlativeResult(index: number): SuperlativeResult {
    const votes = this.state.superlativeVotes[String(index)] ?? {};
    const counts = new Map<string, number>();
    for (const ideaId of Object.values(votes)) {
      if (this.idea(ideaId)) counts.set(ideaId, (counts.get(ideaId) ?? 0) + 1);
    }
    const created = (id: string) => this.idea(id)?.createdAt ?? 0;
    const sorted = [...counts].sort((a, b) => b[1] - a[1] || created(a[0]) - created(b[0]));
    const max = sorted[0]?.[1] ?? 0;
    return {
      index,
      text: SUPERLATIVES[index],
      totalVotes: [...counts.values()].reduce((a, b) => a + b, 0),
      top: sorted.slice(0, 3).map(([ideaId, v]) => ({ ideaId, votes: v })),
      winnerIds: max > 0 ? sorted.filter(([, v]) => v === max).map(([id]) => id) : [],
    };
  }

  /** Superlatives whose results are public: every finished one, plus the current one once time is up. */
  revealedSuperlatives(): SuperlativeResult[] {
    const s = this.state;
    if (s.phase === 'finished') return SUPERLATIVES.map((_, i) => this.superlativeResult(i));
    if (s.phase !== 'superlatives') return [];
    const last = s.locked ? s.superlativeIndex : s.superlativeIndex - 1;
    const out: SuperlativeResult[] = [];
    for (let i = 0; i <= last; i++) out.push(this.superlativeResult(i));
    return out;
  }

  /** Idea ids whose authors may be shown: vote winners once voting closes, superlative winners once revealed, all at the end. */
  revealedAuthorIds(): Set<string> {
    const s = this.state;
    if (s.phase === 'finished') return new Set(s.ideas.map((i) => i.id));
    const ids = new Set<string>();
    const votingDone = (s.phase === 'vote' && s.locked) || s.phase === 'superlatives';
    if (votingDone) for (const w of voteWinners(s.ideas, this.tallies())) ids.add(w.item.id);
    for (const r of this.revealedSuperlatives()) for (const id of r.winnerIds) ids.add(id);
    return ids;
  }

  // ---------- views ----------

  publicIdeas(): PublicIdea[] {
    const revealed = this.revealedAuthorIds();
    return [...this.state.ideas]
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((i) => ({
        id: i.id,
        title: i.title,
        description: i.description,
        createdAt: i.createdAt,
        authorNumber: revealed.has(i.id) ? (this.group(i.groupId)?.number ?? null) : null,
      }));
  }

  private memberNames(memberIds: string[]): string[] {
    const byId = new Map(this.state.participants.map((p) => [p.id, p.name]));
    return memberIds.map((id) => byId.get(id) ?? 'Unknown');
  }

  publicState(): PublicState {
    const s = this.state;
    const joined = this.joinedGroupIds();
    const showTallies = s.phase === 'vote' || s.phase === 'superlatives' || s.phase === 'finished';
    let votesCast = 0;
    let votesPossible = 0;
    for (const pid of this.teamedPlayerIds()) {
      const gid = this.playerGroup(pid)?.id;
      votesCast += Object.keys(s.votes[pid] ?? {}).filter((id) => this.idea(id)).length;
      votesPossible += s.ideas.filter((i) => i.groupId !== gid).length;
    }
    let superlative: PublicState['superlative'] = null;
    if (s.phase === 'superlatives' && s.superlativeIndex >= 0) {
      const votes = s.superlativeVotes[String(s.superlativeIndex)] ?? {};
      superlative = {
        index: s.superlativeIndex,
        total: SUPERLATIVES.length,
        text: SUPERLATIVES[s.superlativeIndex],
        votedCount: Object.keys(votes).length,
        eligibleCount: this.teamedPlayerIds().length,
        result: s.locked ? this.superlativeResult(s.superlativeIndex) : null,
      };
    }
    return {
      serverNow: this.now(),
      phase: s.phase,
      locked: s.locked,
      timer: s.timer,
      groups: s.groups.map((g) => ({
        id: g.id,
        number: g.number,
        members: this.memberNames(g.memberIds),
        joined: joined.has(g.id),
      })),
      ideaCount: s.ideas.length,
      playerCount: Object.keys(this.players()).length,
      ideaTarget: s.groups.length * IDEAS_PER_GROUP,
      tallies: showTallies ? this.tallies() : null,
      votesCast,
      votesPossible,
      superlative,
      superlativeResults: this.revealedSuperlatives(),
      spotlightIdeaId: s.spotlightIdeaId,
      durations: { submitMs: this.cfg.submitMs, voteMs: this.cfg.voteMs, superlativeMs: this.cfg.superlativeMs },
    };
  }

  meState(playerId: string): MeState | null {
    if (!this.players()[playerId]) return null;
    const s = this.state;
    const name = s.participants.find((p) => p.id === playerId)?.name ?? 'Player';
    const g = this.playerGroup(playerId);
    if (!g) {
      return { playerId, name, groupId: '', groupNumber: 0, members: [], ideas: [], votes: {}, superlativeVotes: {} };
    }
    const groupId = g.id;
    const ideas = Array.from({ length: IDEAS_PER_GROUP }, (_, slot) => {
      const i = s.ideas.find((x) => x.groupId === groupId && x.slot === slot);
      return i ? { id: i.id, slot, title: i.title, description: i.description } : null;
    });
    const superlativeVotes: Record<string, string> = {};
    for (const [idx, votes] of Object.entries(s.superlativeVotes)) {
      if (votes[playerId]) superlativeVotes[idx] = votes[playerId];
    }
    return {
      playerId,
      name,
      groupId,
      groupNumber: g.number,
      members: this.memberNames(g.memberIds),
      ideas,
      votes: { ...(s.votes[playerId] ?? {}) },
      superlativeVotes,
    };
  }

  adminState(): AdminState {
    const s = this.state;
    const tallies = this.tallies();
    const cur = s.superlativeVotes[String(s.superlativeIndex)] ?? {};
    const pub = this.publicState();
    return {
      joinCode: s.joinCode,
      players: s.participants.filter((p) => this.players()[p.id]).map((p) => p.name),
      participants: s.participants.map((p) => p.name),
      groups: pub.groups.map((g) => ({
        ...g,
        claimedAt: s.claims[g.id]?.claimedAt ?? null,
        ideaCount: s.ideas.filter((i) => i.groupId === g.id).length,
        voteCount: g.members.length ? Object.keys(s.votes).filter((pid) => this.playerGroup(pid)?.id === g.id).reduce((n, pid) => n + Object.keys(s.votes[pid]).length, 0) : 0,
        votedSuperlative: Object.keys(cur).some((pid) => this.playerGroup(pid)?.id === g.id),
      })),
      ideas: [...s.ideas]
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((i) => ({
          id: i.id,
          title: i.title,
          description: i.description,
          createdAt: i.createdAt,
          authorNumber: this.group(i.groupId)?.number ?? null,
          groupId: i.groupId,
          groupNumber: this.group(i.groupId)?.number ?? 0,
          tally: tallies[i.id] ?? emptyTally(),
        })),
    };
  }

  // ---------- timer ----------

  private startTimer(ms: number) {
    this.state.timer = { durationMs: ms, endsAt: this.now() + ms, pausedRemainingMs: null };
    this.state.locked = false;
  }

  private stopTimer() {
    const t = this.state.timer;
    this.state.timer = { durationMs: t?.durationMs ?? 0, endsAt: null, pausedRemainingMs: null };
    this.state.locked = true;
  }

  private inTimedPhase() {
    return this.state.phase === 'submit' || this.state.phase === 'vote' || this.state.phase === 'superlatives';
  }

  /** Locks the phase when its timer runs out. Returns true if anything changed. */
  tick(): boolean {
    const t = this.state.timer;
    if (t?.endsAt != null && this.now() >= t.endsAt) {
      this.stopTimer();
      return true;
    }
    return false;
  }

  nextTimerDeadline(): number | null {
    return this.state.timer?.endsAt ?? null;
  }

  pause(): Ack {
    const t = this.state.timer;
    if (!t || t.endsAt == null) return fail('No timer is running');
    t.pausedRemainingMs = Math.max(0, t.endsAt - this.now());
    t.endsAt = null;
    return ok();
  }

  resume(): Ack {
    const t = this.state.timer;
    if (!t || t.pausedRemainingMs == null) return fail('The timer is not paused');
    t.endsAt = this.now() + t.pausedRemainingMs;
    t.pausedRemainingMs = null;
    return ok();
  }

  /** Adds time. If time was already up, this reopens the phase for that many seconds. */
  addTime(seconds: number): Ack {
    if (!this.inTimedPhase()) return fail('No timed phase is active');
    const ms = Math.round(Number(seconds) * 1000);
    if (!Number.isFinite(ms) || ms <= 0 || ms > 10 * 60_000) return fail('Pick between 1 second and 10 minutes');
    const t = this.state.timer;
    if (t?.endsAt != null) {
      t.endsAt += ms;
      t.durationMs += ms;
    } else if (t?.pausedRemainingMs != null) {
      t.pausedRemainingMs += ms;
      t.durationMs += ms;
    } else {
      this.startTimer(ms);
    }
    return ok();
  }

  endTimer(): Ack {
    if (!this.inTimedPhase() || this.state.locked) return fail('Nothing to end');
    this.stopTimer();
    return ok();
  }

  // ---------- admin: setup ----------

  private assertNotStarted(): Ack | null {
    const p = this.state.phase;
    if (p !== 'setup' && p !== 'lobby') return fail('The game has started. Reset it first.');
    return null;
  }

  setParticipants(text: string): Ack<{ count: number }> {
    const blocked = this.assertNotStarted();
    if (blocked) return blocked as Ack<never>;
    const names = parseParticipants(text);
    const s = this.state;
    s.participants = names.map((name) => ({ id: newId('p'), name }));
    s.groups = [];
    s.claims = {};
    s.phase = 'setup';
    return ok({ count: names.length });
  }

  generateGroups(): Ack<{ count: number }> {
    const blocked = this.assertNotStarted();
    if (blocked) return blocked as Ack<never>;
    const s = this.state;
    if (s.participants.length < 2) return fail('Add the participant list first');
    const people = shuffle(s.participants.map((p) => p.id));
    let at = 0;
    s.groups = groupSizes(people.length).map((size, i) => {
      const memberIds = people.slice(at, at + size);
      at += size;
      return { id: newId('g'), number: i + 1, memberIds };
    });
    s.claims = {};
    s.ideas = [];
    s.votes = {};
    s.superlativeVotes = {};
    s.superlativeIndex = -1;
    s.phase = 'lobby';
    s.locked = false;
    s.timer = null;
    return ok({ count: s.groups.length });
  }

  rotateJoinCode(): Ack<{ joinCode: string }> {
    this.state.joinCode = makeJoinCode();
    return ok({ joinCode: this.state.joinCode });
  }

  releaseClaim(groupId: string): Ack {
    if (!this.state.claims[groupId]) return fail('That group has no phone joined');
    delete this.state.claims[groupId];
    return ok();
  }

  resetGame(scope: 'game' | 'all'): Ack {
    const s = this.state;
    s.ideas = [];
    s.votes = {};
    s.superlativeVotes = {};
    s.superlativeIndex = -1;
    s.timer = null;
    s.locked = false;
    s.spotlightIdeaId = null;
    s.startedAt = null;
    if (scope === 'all') {
      s.groups = [];
      s.claims = {};
      s.players = {};
      s.participants = [];
      s.joinCode = makeJoinCode();
    }
    s.phase = s.groups.length ? 'lobby' : 'setup';
    return ok();
  }

  // ---------- admin: flow ----------

  /** Opens a fresh waiting room: everyone who opens the link joins it as a new player. */
  openLobby(): Ack {
    const s = this.state;
    const code = s.joinCode;
    this.resetGame('all');
    s.joinCode = code; // keep the code so the QR on screen stays valid
    s.phase = 'lobby';
    return ok();
  }

  /** A phone joins the waiting room as a new player. Late joiners go to the smallest team. */
  joinPlayer(rawName: unknown, code: string): Ack<{ token: string; playerId: string }> {
    const s = this.state;
    if (s.phase === 'setup') return fail("The game isn't open yet. Hang tight.");
    if (!this.checkCode(code)) return fail(BAD_CODE);
    const name = String(rawName ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!name) return fail('Type your name');
    if (Object.keys(this.players()).length >= MAX_PARTICIPANTS) return fail('The game is full');
    const id = newId('p');
    s.participants.push({ id, name });
    const token = randomBytes(24).toString('base64url');
    this.players()[id] = { tokenHash: hashToken(token), claimedAt: this.now() };
    if (s.groups.length) {
      const smallest = [...s.groups].sort((a, b) => a.memberIds.length - b.memberIds.length || a.number - b.number)[0];
      smallest.memberIds.push(id);
    }
    return ok({ token, playerId: id });
  }

  start(): Ack {
    const s = this.state;
    if (s.phase !== 'lobby') return fail('Open the waiting room first');
    if (!s.groups.length) {
      const ids = shuffle(Object.keys(this.players()));
      if (!ids.length) return fail('Nobody has joined yet');
      let at = 0;
      s.groups = groupSizes(ids.length).map((size, i) => {
        const memberIds = ids.slice(at, at + size);
        at += size;
        return { id: newId('g'), number: i + 1, memberIds };
      });
    }
    s.phase = 'submit';
    s.startedAt = this.now();
    s.spotlightIdeaId = null;
    this.startTimer(this.cfg.submitMs);
    return ok();
  }

  next(): Ack<{ phase: Phase }> {
    const s = this.state;
    if (s.phase === 'lobby') {
      const r = this.start();
      return r.ok ? ok({ phase: s.phase }) : (r as Ack<never>);
    }
    if (!this.inTimedPhase()) return fail('Nothing to advance to');
    if (!s.locked) return fail('End the timer first');
    s.spotlightIdeaId = null;
    if (s.phase === 'submit') {
      s.phase = 'vote';
      this.startTimer(this.cfg.voteMs);
    } else if (s.phase === 'vote') {
      s.phase = 'superlatives';
      s.superlativeIndex = 0;
      this.startTimer(this.cfg.superlativeMs);
    } else if (s.superlativeIndex < SUPERLATIVES.length - 1) {
      s.superlativeIndex++;
      this.startTimer(this.cfg.superlativeMs);
    } else {
      s.phase = 'finished';
      s.timer = null;
      s.locked = true;
    }
    return ok({ phase: s.phase });
  }

  spotlight(ideaId: string | null): Ack {
    if (ideaId && !this.idea(ideaId)) return fail('No such idea');
    this.state.spotlightIdeaId = ideaId || null;
    return ok();
  }

  removeIdea(ideaId: string): Ack {
    const s = this.state;
    if (!this.idea(ideaId)) return fail('No such idea');
    s.ideas = s.ideas.filter((i) => i.id !== ideaId);
    for (const votes of Object.values(s.votes)) delete votes[ideaId];
    for (const votes of Object.values(s.superlativeVotes)) {
      for (const [gid, id] of Object.entries(votes)) if (id === ideaId) delete votes[gid];
    }
    if (s.spotlightIdeaId === ideaId) s.spotlightIdeaId = null;
    return ok();
  }

  // ---------- players ----------

  claim(groupId: string, code: string): Ack<{ token: string; groupId: string }> {
    const s = this.state;
    if (s.phase === 'setup' || !s.groups.length) return fail("Groups aren't out yet. Hang tight.");
    if (!this.checkCode(code)) return fail(BAD_CODE);
    const g = this.group(groupId);
    if (!g) return fail('That group no longer exists. Refresh and pick again.');
    if (s.claims[groupId]) {
      return fail(`Another phone already joined as Group ${g.number}. Use that phone, or ask an organizer to release it.`);
    }
    const token = randomBytes(24).toString('base64url');
    s.claims[groupId] = { tokenHash: hashToken(token), claimedAt: this.now() };
    return ok({ token, groupId });
  }

  saveIdea(groupId: string, slot: unknown, title: unknown, description: unknown): Ack<{ ideaId: string }> {
    const s = this.state;
    if (s.phase !== 'submit' || s.locked) return fail('Idea submissions are closed');
    if (!this.group(groupId)) return fail('Unknown group');
    const n = Number(slot);
    if (!Number.isInteger(n) || n < 0 || n >= IDEAS_PER_GROUP) return fail('Bad idea slot');
    const t = cleanTitle(String(title ?? ''));
    const d = cleanDescription(String(description ?? ''));
    if (!t) return fail('Give your idea a title');
    if (t.length > TITLE_MAX_CHARS) return fail(`Keep the title under ${TITLE_MAX_CHARS} characters`);
    const words = countWords(d);
    if (words > DESCRIPTION_MAX_WORDS) return fail(`Keep it to ${DESCRIPTION_MAX_WORDS} words (you have ${words})`);
    if (d.length > DESCRIPTION_MAX_CHARS) return fail('That description is too long');
    const now = this.now();
    const existing = s.ideas.find((i) => i.groupId === groupId && i.slot === n);
    if (existing) {
      existing.title = t;
      existing.description = d;
      existing.updatedAt = now;
      return ok({ ideaId: existing.id });
    }
    const idea = { id: newId('idea'), groupId, slot: n, title: t, description: d, createdAt: now, updatedAt: now };
    s.ideas.push(idea);
    return ok({ ideaId: idea.id });
  }

  vote(playerId: string, ideaId: unknown, kind: unknown): Ack {
    const s = this.state;
    if (s.phase !== 'vote' || s.locked) return fail('Voting is closed');
    const groupId = this.playerGroup(playerId)?.id;
    if (!groupId) return fail("You're not on a team yet");
    if (!VOTE_KINDS.includes(kind as VoteKind)) return fail('Pick 🚀, 😐 or 💩');
    const idea = this.idea(String(ideaId));
    if (!idea) return fail('That idea is gone');
    if (idea.groupId === groupId) return fail("You can't vote on your own idea");
    const mine = (s.votes[playerId] ??= {});
    if (mine[idea.id]) return fail('You already voted on this one');
    mine[idea.id] = kind as VoteKind;
    return ok();
  }

  superlativeVote(playerId: string, index: unknown, ideaId: unknown): Ack {
    const s = this.state;
    if (s.phase !== 'superlatives' || s.locked) return fail('Voting for this superlative is closed');
    if (Number(index) !== s.superlativeIndex) return fail('That superlative is over');
    const groupId = this.playerGroup(playerId)?.id;
    if (!groupId) return fail("You're not on a team yet");
    const idea = this.idea(String(ideaId));
    if (!idea) return fail('That idea is gone');
    if (idea.groupId === groupId) return fail("You can't vote for your own idea");
    const votes = (s.superlativeVotes[String(s.superlativeIndex)] ??= {});
    if (votes[playerId]) return fail('You already voted');
    votes[playerId] = idea.id;
    return ok();
  }
}
