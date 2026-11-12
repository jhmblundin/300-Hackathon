// Game rules shared by the server (which enforces them) and the client (which shows them).
// The server is the only source of truth: every limit here is re-checked server-side.

export const SUPERLATIVES = [
  'Most likely to generate pushback from local communities',
  'Least defensible business',
  "Most likely to get invested in by an over-eager VC that doesn't know jack about the technical side of the business",
  'Most likely to cause a wildfire',
  'Least likely to get invested in',
  'Most likely to get hacked',
] as const;

export const GROUP_SIZE = 4;
export const IDEAS_PER_GROUP = 2;
export const TITLE_MAX_CHARS = 80;
export const DESCRIPTION_MAX_WORDS = 200;
export const DESCRIPTION_MAX_CHARS = 2000;

export const VOTE_KINDS = ['rocket', 'meh', 'poop'] as const;
export type VoteKind = (typeof VOTE_KINDS)[number];

export const VOTE_META: Record<VoteKind, { emoji: string; label: string; points: number }> = {
  rocket: { emoji: '🚀', label: 'Good idea', points: 1 },
  meh: { emoji: '😐', label: 'Okay idea', points: 0 },
  poop: { emoji: '💩', label: 'Bad idea', points: -1 },
};

export interface Tally {
  rocket: number;
  meh: number;
  poop: number;
}

export const emptyTally = (): Tally => ({ rocket: 0, meh: 0, poop: 0 });

export const scoreOf = (t: Tally): number =>
  t.rocket * VOTE_META.rocket.points + t.meh * VOTE_META.meh.points + t.poop * VOTE_META.poop.points;

export const totalVotes = (t: Tally): number => t.rocket + t.meh + t.poop;

export function countWords(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

/** Split n people into groups of `size`, as evenly as possible (62 -> 14 of 4 + 2 of 3). */
export function groupSizes(n: number, size = GROUP_SIZE): number[] {
  if (n <= 0) return [];
  const count = Math.ceil(n / size);
  const base = Math.floor(n / count);
  const extra = n % count;
  return Array.from({ length: count }, (_, i) => (i < extra ? base + 1 : base));
}

export interface Ranked<T> {
  item: T;
  tally: Tally;
  score: number;
  rank: number;
}

/**
 * Leaderboard order: net score, then more rockets, then fewer poops, then earliest submitted.
 * Rows that tie on score, rockets and poops share a rank.
 */
export function rankIdeas<T extends { id: string; createdAt: number }>(
  items: T[],
  tallies: Record<string, Tally> | null | undefined,
): Ranked<T>[] {
  const rows = items.map((item) => {
    const tally = tallies?.[item.id] ?? emptyTally();
    return { item, tally, score: scoreOf(tally), rank: 0 };
  });
  rows.sort(
    (a, b) =>
      b.score - a.score ||
      b.tally.rocket - a.tally.rocket ||
      a.tally.poop - b.tally.poop ||
      a.item.createdAt - b.item.createdAt ||
      a.item.id.localeCompare(b.item.id),
  );
  rows.forEach((r, i) => {
    const p = rows[i - 1];
    r.rank =
      p && p.score === r.score && p.tally.rocket === r.tally.rocket && p.tally.poop === r.tally.poop ? p.rank : i + 1;
  });
  return rows;
}

/** The idea(s) in first place, or none if nobody has voted yet. */
export function voteWinners<T extends { id: string; createdAt: number }>(
  items: T[],
  tallies: Record<string, Tally> | null | undefined,
): Ranked<T>[] {
  const ranked = rankIdeas(items, tallies);
  const anyVotes = ranked.some((r) => totalVotes(r.tally) > 0);
  return anyVotes ? ranked.filter((r) => r.rank === 1) : [];
}

export const PHASE_LABEL = {
  setup: 'Setup',
  lobby: 'Lobby',
  submit: 'Phase 1 · Pitch',
  vote: 'Phase 2 · Vote',
  superlatives: 'Phase 3 · Superlatives',
  finished: "That's a wrap",
} as const;
