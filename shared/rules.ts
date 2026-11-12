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
/** Each person writes their own idea(s) on their own phone (Sean, 2026-11-12: no shared typing). */
export const IDEAS_PER_PLAYER = 1;
export const IDEAS_PER_GROUP = IDEAS_PER_PLAYER;
export const TITLE_MAX_CHARS = 80;
export const DESCRIPTION_MAX_WORDS = 200;
export const DESCRIPTION_MAX_CHARS = 2000;

// Sean, 2026-11-12: six ratings, best to worst. Each one is worth points on the live leaderboard.
export const VOTE_KINDS = ['star', 'rocket', 'smile', 'confused', 'poop', 'megapoop'] as const;
export type VoteKind = (typeof VOTE_KINDS)[number];

export const VOTE_META: Record<VoteKind, { emoji: string; label: string; points: number }> = {
  star: { emoji: '⭐', label: 'Genius', points: 5 },
  rocket: { emoji: '🚀', label: 'Great', points: 3 },
  smile: { emoji: '😊', label: 'Nice', points: 1 },
  confused: { emoji: '😕', label: 'Huh?', points: 0 },
  poop: { emoji: '💩', label: 'Bad', points: -1 },
  megapoop: { emoji: '💩💩💩💩💩💩💩💩💩💩', label: 'Terrible', points: -5 },
};

export type Tally = Record<VoteKind, number>;

export const emptyTally = (): Tally => ({ star: 0, rocket: 0, smile: 0, confused: 0, poop: 0, megapoop: 0 });

export const scoreOf = (t: Tally): number => VOTE_KINDS.reduce((n, k) => n + (t[k] ?? 0) * VOTE_META[k].points, 0);

export const totalVotes = (t: Tally): number => VOTE_KINDS.reduce((n, k) => n + (t[k] ?? 0), 0);

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
      b.tally.star - a.tally.star ||
      b.tally.rocket - a.tally.rocket ||
      a.tally.megapoop - b.tally.megapoop ||
      a.item.createdAt - b.item.createdAt ||
      a.item.id.localeCompare(b.item.id),
  );
  rows.forEach((r, i) => {
    const p = rows[i - 1];
    r.rank =
      p && p.score === r.score && p.tally.star === r.tally.star && p.tally.rocket === r.tally.rocket && p.tally.megapoop === r.tally.megapoop ? p.rank : i + 1;
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
  submit: 'Phase 1 · Ideas',
  vote: 'Phase 2 · Vote',
  superlatives: 'Phase 3 · Superlatives',
  finished: "That's a wrap",
} as const;
