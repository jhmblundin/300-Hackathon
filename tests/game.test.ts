import { describe, expect, it } from 'vitest';
import { countWords, groupSizes, rankIdeas, voteWinners } from '../shared/rules';
import { Game, hashToken, parseParticipants } from '../server/game';

const cfg = { submitMs: 180_000, voteMs: 180_000, superlativeMs: 60_000 };

function names(n: number) {
  return Array.from({ length: n }, (_, i) => `Person ${i + 1}`).join('\n');
}

function setup(n = 62) {
  let now = 1_000_000;
  const clock = () => now;
  const game = new Game(cfg, null, clock);
  game.setParticipants(names(n));
  game.generateGroups();
  const tokens = new Map<string, string>();
  for (const g of game.state.groups) {
    const r = game.claim(g.id, game.state.joinCode);
    if (!r.ok) throw new Error(r.error);
    tokens.set(g.id, r.token);
  }
  return { game, tokens, advance: (ms: number) => (now += ms) };
}

describe('groups', () => {
  it('splits 62 people into 14 groups of 4 and 2 of 3', () => {
    const sizes = groupSizes(62);
    expect(sizes.length).toBe(16);
    expect(sizes.filter((s) => s === 4).length).toBe(14);
    expect(sizes.filter((s) => s === 3).length).toBe(2);
  });

  it('never makes a group smaller than 3 for 6+ people', () => {
    for (let n = 6; n <= 200; n++) {
      const s = groupSizes(n);
      expect(s.reduce((a, b) => a + b, 0)).toBe(n);
      expect(Math.min(...s)).toBeGreaterThanOrEqual(3);
      expect(Math.max(...s)).toBeLessThanOrEqual(4);
    }
  });

  it('puts every participant in exactly one group', () => {
    const { game } = setup(62);
    const ids = game.state.groups.flatMap((g) => g.memberIds);
    expect(ids.length).toBe(62);
    expect(new Set(ids).size).toBe(62);
  });

  it('reshuffles into different groups', () => {
    const { game } = setup(62);
    const before = JSON.stringify(game.state.groups.map((g) => g.memberIds));
    game.generateGroups();
    expect(JSON.stringify(game.state.groups.map((g) => g.memberIds))).not.toBe(before);
  });

  it('parses a tab-separated spreadsheet paste', () => {
    expect(parseParticipants('Ada\tLovelace\n\n  Zoë\tÇelik \nMaría\tGarcía-López')).toEqual([
      'Ada Lovelace',
      'Zoë Çelik',
      'María García-López',
    ]);
  });
});

describe('joining', () => {
  it('needs the join code and allows one phone per group', () => {
    const game = new Game(cfg);
    game.setParticipants(names(8));
    game.generateGroups();
    const g = game.state.groups[0];
    expect(game.claim(g.id, 'WRONG').ok).toBe(false);
    const r = game.claim(g.id, game.state.joinCode.toLowerCase());
    expect(r.ok).toBe(true);
    expect(game.claim(g.id, game.state.joinCode).ok).toBe(false);
    if (r.ok) {
      expect(game.groupForToken(r.token)).toBe(g.id);
      // Only a hash of the token is stored.
      expect(JSON.stringify(game.state)).not.toContain(r.token);
      expect(game.state.claims[g.id].tokenHash).toBe(hashToken(r.token));
    }
    game.releaseClaim(g.id);
    expect(game.claim(g.id, game.state.joinCode).ok).toBe(true);
  });
});

describe('a full game', () => {
  it('runs pitch -> vote -> 6 superlatives -> finished with every rule enforced', () => {
    const { game, advance } = setup(62);
    const [g1, g2, g3] = game.state.groups;

    // Can't submit before the game starts.
    expect(game.saveIdea(g1.id, 0, 'Too early', 'nope').ok).toBe(false);
    expect(game.start().ok).toBe(true);
    expect(game.state.phase).toBe('submit');

    // Word cap.
    const long = Array.from({ length: 201 }, () => 'word').join(' ');
    expect(game.saveIdea(g1.id, 0, 'Long', long).ok).toBe(false);
    expect(game.saveIdea(g1.id, 0, 'Exactly 200', Array.from({ length: 200 }, () => 'w').join(' ')).ok).toBe(true);
    // Editing replaces, doesn't add.
    expect(game.saveIdea(g1.id, 0, 'Dog Uber', 'Uber, for dogs.').ok).toBe(true);
    expect(game.saveIdea(g1.id, 2, 'Third idea', 'no').ok).toBe(false);
    expect(game.saveIdea(g1.id, 1, 'Cat Lyft', 'Lyft, for cats.').ok).toBe(true);
    expect(game.saveIdea(g2.id, 0, 'Fire Drone', 'A drone that starts campfires.').ok).toBe(true);
    expect(game.saveIdea(g3.id, 0, 'VC Bait', 'AI blockchain for AI.').ok).toBe(true);
    expect(game.state.ideas.length).toBe(4);

    // Ideas are anonymous on the public board.
    expect(game.publicIdeas().every((i) => i.authorNumber === null)).toBe(true);
    expect(JSON.stringify(game.publicState())).not.toContain(g1.id + '"' + ':');

    // Timer runs out -> locked; can't advance until locked.
    expect(game.next().ok).toBe(false);
    advance(cfg.submitMs + 1);
    expect(game.tick()).toBe(true);
    expect(game.state.locked).toBe(true);
    expect(game.saveIdea(g1.id, 0, 'Late', 'late').ok).toBe(false);
    expect(game.next().ok).toBe(true);
    expect(game.state.phase).toBe('vote');

    const [dog, cat, fire, vc] = game.state.ideas;
    // No self-votes, one vote per idea.
    expect(game.vote(g1.id, dog.id, 'rocket').ok).toBe(false);
    expect(game.vote(g2.id, dog.id, 'rocket').ok).toBe(true);
    expect(game.vote(g2.id, dog.id, 'poop').ok).toBe(false);
    expect(game.vote(g2.id, dog.id, 'banana').ok).toBe(false);
    expect(game.vote(g3.id, dog.id, 'rocket').ok).toBe(true);
    expect(game.vote(g1.id, fire.id, 'poop').ok).toBe(true);
    expect(game.vote(g3.id, fire.id, 'meh').ok).toBe(true);
    expect(game.vote(g1.id, vc.id, 'rocket').ok).toBe(true);
    expect(game.vote(g2.id, cat.id, 'poop').ok).toBe(true);

    const tallies = game.publicState().tallies!;
    expect(tallies[dog.id]).toEqual({ rocket: 2, meh: 0, poop: 0 });
    const ranked = rankIdeas(game.publicIdeas(), tallies);
    expect(ranked[0].item.id).toBe(dog.id);
    expect(ranked[0].score).toBe(2);
    expect(ranked.at(-1)!.score).toBe(-1);

    // Winner's group is revealed once voting closes; others stay hidden.
    expect(game.endTimer().ok).toBe(true);
    const pub = game.publicIdeas();
    expect(pub.find((i) => i.id === dog.id)!.authorNumber).toBe(g1.number);
    expect(pub.find((i) => i.id === fire.id)!.authorNumber).toBe(null);
    expect(game.vote(g3.id, cat.id, 'rocket').ok).toBe(false);

    // Superlatives.
    expect(game.next().ok).toBe(true);
    expect(game.state.phase).toBe('superlatives');
    for (let i = 0; i < 6; i++) {
      expect(game.state.superlativeIndex).toBe(i);
      expect(game.superlativeVote(g1.id, i, dog.id).ok).toBe(false); // own idea
      expect(game.superlativeVote(g2.id, i, fire.id).ok).toBe(false); // own idea
      expect(game.superlativeVote(g1.id, i, fire.id).ok).toBe(true);
      expect(game.superlativeVote(g1.id, i, vc.id).ok).toBe(false); // already voted
      expect(game.superlativeVote(g3.id, i, i % 2 ? dog.id : fire.id).ok).toBe(true);
      // Hidden until time is up.
      expect(game.publicState().superlative!.result).toBe(null);
      expect(game.publicState().superlative!.votedCount).toBe(2);
      advance(cfg.superlativeMs + 1);
      game.tick();
      const result = game.publicState().superlative!.result!;
      expect(result.winnerIds).toEqual(i % 2 ? [fire.id, dog.id].sort((a, b) => game.idea(a)!.createdAt - game.idea(b)!.createdAt) : [fire.id]);
      expect(game.next().ok).toBe(true);
    }
    expect(game.state.phase).toBe('finished');
    expect(game.publicIdeas().every((i) => i.authorNumber != null)).toBe(true);
    expect(game.publicState().superlativeResults.length).toBe(6);
  });

  it('pause, resume and add time', () => {
    const { game, advance } = setup(8);
    game.start();
    advance(60_000);
    game.pause();
    advance(600_000);
    expect(game.tick()).toBe(false);
    game.resume();
    expect(game.state.timer!.endsAt! - 1_000_000 - 660_000).toBe(120_000);
    game.addTime(30);
    advance(150_000 - 1);
    expect(game.tick()).toBe(false);
    advance(2);
    expect(game.tick()).toBe(true);
    // +30s after time's up reopens the phase.
    expect(game.addTime(30).ok).toBe(true);
    expect(game.state.locked).toBe(false);
  });

  it("can't change the list or reshuffle once started; restart keeps groups", () => {
    const { game } = setup(8);
    game.start();
    expect(game.generateGroups().ok).toBe(false);
    expect(game.setParticipants('A\nB').ok).toBe(false);
    const groups = JSON.stringify(game.state.groups);
    game.resetGame('game');
    expect(game.state.phase).toBe('lobby');
    expect(JSON.stringify(game.state.groups)).toBe(groups);
    expect(Object.keys(game.state.claims).length).toBe(2);
  });

  it('removing an idea removes its votes', () => {
    const { game } = setup(8);
    const [g1, g2] = game.state.groups;
    game.start();
    game.saveIdea(g1.id, 0, 'Bad', 'Bad words');
    game.endTimer();
    game.next();
    const id = game.state.ideas[0].id;
    game.vote(g2.id, id, 'poop');
    game.removeIdea(id);
    expect(game.state.ideas.length).toBe(0);
    expect(game.state.votes[g2.id][id]).toBeUndefined();
  });

  it('survives a save/load round trip mid-phase', () => {
    const { game } = setup(8);
    game.start();
    const copy = new Game(cfg, JSON.parse(JSON.stringify(game.state)));
    expect(copy.state.phase).toBe('submit');
    expect(copy.state.timer?.endsAt).toBe(game.state.timer?.endsAt);
  });
});

describe('rules helpers', () => {
  it('counts words', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('  one  two\nthree ')).toBe(3);
  });

  it('declares no winner when nobody voted', () => {
    expect(voteWinners([{ id: 'a', createdAt: 1 }], {})).toEqual([]);
  });
});
