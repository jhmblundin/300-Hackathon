import type { Tally, VoteKind } from './rules';

export type Phase = 'setup' | 'lobby' | 'submit' | 'vote' | 'superlatives' | 'finished';

// ---------- Persisted server state (never sent to clients as-is) ----------

export interface Participant {
  id: string;
  name: string;
}

export interface Group {
  id: string;
  number: number;
  memberIds: string[];
}

export interface Idea {
  id: string;
  groupId: string;
  slot: number;
  title: string;
  description: string;
  createdAt: number;
  updatedAt: number;
}

/** Running: endsAt set. Paused: pausedRemainingMs set. Time's up: both null. */
export interface Timer {
  durationMs: number;
  endsAt: number | null;
  pausedRemainingMs: number | null;
}

export interface Claim {
  tokenHash: string;
  claimedAt: number;
}

export interface GameState {
  schemaVersion: 1;
  participants: Participant[];
  groups: Group[];
  joinCode: string;
  /** groupId -> the phone that joined as that group (only a hash of its token is stored). Unused since 2026-11-12. */
  claims: Record<string, Claim>;
  /** participantId -> that player's phone (hash of its token). Every phone that joins is a new player. */
  players?: Record<string, Claim>;
  phase: Phase;
  /** True once the current phase's timer has run out (inputs closed). */
  locked: boolean;
  timer: Timer | null;
  ideas: Idea[];
  /** participantId -> ideaId -> vote (one vote per person) */
  votes: Record<string, Record<string, VoteKind>>;
  superlativeIndex: number;
  /** String(superlative index) -> participantId -> ideaId */
  superlativeVotes: Record<string, Record<string, string>>;
  spotlightIdeaId: string | null;
  startedAt: number | null;
}

// ---------- Payloads sent to clients ----------

export interface PublicGroup {
  id: string;
  number: number;
  members: string[];
  joined: boolean;
}

export interface PublicIdea {
  id: string;
  title: string;
  description: string;
  createdAt: number;
  /** Group number, only once authorship is revealed (winners, and everything at the end). */
  authorNumber: number | null;
}

export interface SuperlativeResult {
  index: number;
  text: string;
  totalVotes: number;
  top: { ideaId: string; votes: number }[];
  winnerIds: string[];
}

export interface PublicState {
  serverNow: number;
  phase: Phase;
  locked: boolean;
  timer: Timer | null;
  groups: PublicGroup[];
  ideaCount: number;
  playerCount: number;
  ideaTarget: number;
  /** Live emoji tallies; null until the voting phase starts. */
  tallies: Record<string, Tally> | null;
  votesCast: number;
  votesPossible: number;
  superlative: {
    index: number;
    total: number;
    text: string;
    votedCount: number;
    eligibleCount: number;
    result: SuperlativeResult | null;
  } | null;
  superlativeResults: SuperlativeResult[];
  spotlightIdeaId: string | null;
  durations: { submitMs: number; voteMs: number; superlativeMs: number };
}

export interface MyIdea {
  id: string;
  slot: number;
  title: string;
  description: string;
}

export interface MeState {
  playerId: string;
  name: string;
  /** Empty until the game starts and teams are made. */
  groupId: string;
  groupNumber: number;
  members: string[];
  ideas: (MyIdea | null)[];
  votes: Record<string, VoteKind>;
  /** String(superlative index) -> ideaId */
  superlativeVotes: Record<string, string>;
}

export interface AdminIdea extends PublicIdea {
  groupId: string;
  groupNumber: number;
  tally: Tally;
}

export interface AdminState {
  joinCode: string;
  /** Players in the waiting room, newest last. */
  players: string[];
  participants: string[];
  groups: (PublicGroup & { claimedAt: number | null; ideaCount: number; voteCount: number; votedSuperlative: boolean })[];
  ideas: AdminIdea[];
}

export type Ack<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export type HelloAck =
  | { ok: true; mode: 'group'; groupId: string; playerId: string }
  | { ok: true; mode: 'viewer'; tokenInvalid: boolean }
  | { ok: false; mode: 'needCode'; error?: string };
