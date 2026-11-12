// End-to-end rehearsal: an admin + one socket per group play a whole game against a running server.
//   BASE_URL=http://localhost:3300 ADMIN_PASSWORD=... npx tsx scripts/simulate.ts
// Run the server with short phases (SUBMIT_SECONDS=6 VOTE_SECONDS=6 SUPERLATIVE_SECONDS=3) for a fast run.
// NAMES_FILE=path.txt uses a real list (one per line); otherwise 62 fake names.

import { readFileSync } from 'node:fs';
import { io, type Socket } from 'socket.io-client';
import { SUPERLATIVES, VOTE_KINDS, rankIdeas, totalVotes } from '../shared/rules';
import type { AdminState, MeState, PublicIdea, PublicState } from '../shared/types';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'dev';
const names = process.env.NAMES_FILE
  ? readFileSync(process.env.NAMES_FILE, 'utf8')
  : Array.from({ length: 62 }, (_, i) => `First${i + 1}\tLast${i + 1}`).join('\n');

let failures = 0;
function check(cond: unknown, what: string) {
  if (cond) console.log(`  ✓ ${what}`);
  else {
    failures++;
    console.log(`  ✗ ${what}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pick = <T>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)];

function ack<T = any>(s: Socket, ev: string, payload: object): Promise<T> {
  return s.timeout(5000).emitWithAck(ev, payload) as Promise<T>;
}

interface Client {
  s: Socket;
  pub?: PublicState;
  ideas: PublicIdea[];
  me?: MeState;
  admin?: AdminState;
}

function client(cookie?: string): Promise<Client> {
  const c: Client = { s: io(BASE, { path: '/ideaathon/socket.io', transports: ['websocket'], extraHeaders: cookie ? { cookie } : {} }), ideas: [] };
  c.s.on('public', (p) => (c.pub = p));
  c.s.on('ideas', (i) => (c.ideas = i));
  c.s.on('me', (m) => (c.me = m));
  c.s.on('admin', (a) => (c.admin = a));
  return new Promise((resolve, reject) => {
    c.s.once('connect', () => resolve(c));
    c.s.once('connect_error', reject);
  });
}

async function until(fn: () => boolean, what: string, ms = 30_000) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error(`Timed out waiting for: ${what}`);
    await sleep(50);
  }
}

async function main() {
  console.log(`Rehearsal against ${BASE}`);

  // --- admin auth ---
  const bad = await fetch(`${BASE}/ideaathon/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'definitely-wrong' }),
  });
  check(bad.status === 401, 'wrong admin passcode is rejected');
  const res = await fetch(`${BASE}/ideaathon/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  });
  const cookie = res.headers.get('set-cookie')?.split(';')[0] ?? '';
  check(res.ok && cookie.startsWith('h300_admin='), 'admin signs in');
  const admin = await client(cookie);
  const A = (type: string, extra: object = {}) => ack(admin.s, 'admin:action', { type, ...extra });

  // --- outsiders get nothing ---
  const outsider = await client();
  const forged = await ack(outsider.s, 'admin:action', { type: 'resetGame', scope: 'all' });
  check(!forged.ok, 'non-admin socket cannot run admin actions');
  const helloNoCode = await ack(outsider.s, 'player:hello', {});
  check(!helloNoCode.ok && helloNoCode.mode === 'needCode', 'no join code -> asked for the code');
  const helloBad = await ack(outsider.s, 'player:hello', { code: 'ZZZZZ' });
  check(!helloBad.ok, 'wrong join code is rejected');
  await sleep(200);
  check(!outsider.pub, 'outsider never receives game state (names stay private)');

  // --- setup ---
  check((await A('resetGame', { scope: 'all' })).ok, 'reset everything');
  const set = await A('setParticipants', { text: names });
  check(set.ok && set.count === names.split('\n').filter((l) => l.trim()).length, `participant list saved (${set.count})`);
  check((await A('generateGroups')).ok, 'groups generated');
  await until(() => admin.admin?.groups.length === 16 && admin.pub?.phase === 'lobby', 'admin sees 16 groups');
  const sizes = admin.admin!.groups.map((g) => g.members.length);
  check(sizes.filter((s) => s === 4).length === 14 && sizes.filter((s) => s === 3).length === 2, '14 groups of 4 + 2 of 3');
  const allMembers = admin.admin!.groups.flatMap((g) => g.members);
  check(new Set(allMembers).size === allMembers.length && allMembers.length === set.count, 'everyone in exactly one group');
  const code = admin.admin!.joinCode;

  // --- every group joins ---
  const players: (Client & { groupId: string; token: string })[] = [];
  for (const g of admin.admin!.groups) {
    const c = await client();
    const hello = await ack(c.s, 'player:hello', { code });
    if (!hello.ok) throw new Error('hello failed');
    const claim = await ack(c.s, 'player:claim', { groupId: g.id, code });
    if (!claim.ok) throw new Error(`claim failed: ${claim.error}`);
    players.push(Object.assign(c, { groupId: g.id, token: claim.token }));
  }
  await until(() => players.every((p) => p.me && p.pub), 'all phones get their group');
  check(players.length === 16, '16 phones joined');
  const dupe = await client();
  await ack(dupe.s, 'player:hello', { code });
  const dupeClaim = await ack(dupe.s, 'player:claim', { groupId: players[0].groupId, code });
  check(!dupeClaim.ok, 'a second phone cannot join a group that already has one');
  dupe.s.close();
  await until(() => admin.pub!.groups.every((g) => g.joined), 'screen shows all groups joined');
  check(true, 'big screen lobby shows 16/16 joined');

  // --- phase 1: pitch ---
  check((await A('start')).ok, 'admin starts the game');
  await until(() => players.every((p) => p.pub?.phase === 'submit'), 'phones enter pitch phase');
  const tooLong = await ack(players[0].s, 'player:saveIdea', {
    slot: 0,
    title: 'Too long',
    description: Array.from({ length: 201 }, () => 'word').join(' '),
  });
  check(!tooLong.ok, '201-word description rejected');
  for (const [i, p] of players.entries()) {
    for (const slot of [0, 1]) {
      const r = await ack(p.s, 'player:saveIdea', {
        slot,
        title: `G${i + 1} idea ${slot + 1}`,
        description: `A startup from group ${i + 1}, number ${slot + 1}. It does things with AI.`,
      });
      if (!r.ok) throw new Error(r.error);
    }
  }
  await until(() => admin.pub!.ideaCount === 32, '32 ideas');
  check(admin.ideas.length === 32 && admin.ideas.every((i) => i.authorNumber === null), '32 ideas on the board, all anonymous');
  const extra = await ack(players[0].s, 'player:saveIdea', { slot: 2, title: 'Third', description: 'nope' });
  check(!extra.ok, 'a third idea is rejected');

  console.log('  … waiting for the pitch timer to run out (server-side)');
  await until(() => admin.pub!.locked, 'pitch timer expires', 120_000);
  const late = await ack(players[1].s, 'player:saveIdea', { slot: 0, title: 'Late edit', description: 'late' });
  check(!late.ok, 'edits rejected after time is up');

  // --- phase 2: vote ---
  check((await A('next')).ok, 'admin starts voting');
  await until(() => players.every((p) => p.pub?.phase === 'vote' && !p.pub.locked), 'phones enter voting');
  const p0 = players[0];
  const ownId = p0.me!.ideas[0]!.id;
  check(!(await ack(p0.s, 'player:vote', { ideaId: ownId, kind: 'rocket' })).ok, 'self-vote rejected');
  let cast = 0;
  const t0 = Date.now();
  await Promise.all(
    players.map(async (p) => {
      const mine = new Set(p.me!.ideas.map((i) => i!.id));
      for (const idea of p.ideas) {
        if (mine.has(idea.id)) continue;
        const r = await ack(p.s, 'player:vote', { ideaId: idea.id, kind: pick(VOTE_KINDS) });
        if (r.ok) cast++;
      }
    }),
  );
  check(cast === 16 * 30, `all ${cast} emoji votes accepted in ${Date.now() - t0} ms (16 phones voting at once)`);
  const other = p0.ideas.find((i) => !p0.me!.ideas.some((m) => m?.id === i.id))!;
  check(!(await ack(p0.s, 'player:vote', { ideaId: other.id, kind: 'poop' })).ok, 'second vote on the same idea rejected');
  await until(() => admin.pub!.votesCast === 480, 'screen shows 480 votes');
  const tallied = Object.values(admin.pub!.tallies!).reduce((a, t) => a + totalVotes(t), 0);
  check(tallied === 480, 'live tallies add up to 480');
  check(admin.pub!.votesPossible === 480, 'votes possible = 16 × 30');

  console.log('  … waiting for the vote timer');
  await until(() => admin.pub!.locked, 'vote timer expires', 120_000);
  await sleep(200);
  const ranked = rankIdeas(admin.ideas, admin.pub!.tallies);
  const top = ranked.filter((r) => r.rank === 1);
  check(top.every((r) => r.item.authorNumber != null), `winner revealed: "${top[0].item.title}" (${top[0].score > 0 ? '+' : ''}${top[0].score})`);
  check(ranked.filter((r) => r.rank !== 1).every((r) => r.item.authorNumber == null), 'everyone else stays anonymous');

  // --- phase 3: superlatives ---
  check((await A('next')).ok, 'admin starts superlatives');
  for (let i = 0; i < SUPERLATIVES.length; i++) {
    await until(() => players.every((p) => p.pub?.superlative?.index === i && !p.pub.locked), `superlative ${i + 1} open`);
    const ownSup = await ack(p0.s, 'player:superlativeVote', { index: i, ideaId: ownId });
    check(!ownSup.ok, `#${i + 1}: voting for your own idea rejected`);
    await Promise.all(
      players.map(async (p) => {
        const mine = new Set(p.me!.ideas.map((x) => x!.id));
        const choice = pick(p.ideas.filter((x) => !mine.has(x.id)));
        const r = await ack(p.s, 'player:superlativeVote', { index: i, ideaId: choice.id });
        if (!r.ok) throw new Error(r.error);
      }),
    );
    await until(() => admin.pub!.superlative?.votedCount === 16, 'all 16 voted');
    check(admin.pub!.superlative!.result === null, `#${i + 1}: results hidden while voting`);
    await until(() => admin.pub!.locked, `superlative ${i + 1} timer`, 60_000);
    const result = admin.pub!.superlative!.result!;
    check(result.totalVotes === 16 && result.winnerIds.length >= 1, `#${i + 1} "${SUPERLATIVES[i].slice(0, 40)}…": ${result.winnerIds.length} winner(s), ${result.top[0].votes} votes`);
    check((await A('next')).ok, i < 5 ? 'next superlative' : 'finish');
  }

  await until(() => admin.pub!.phase === 'finished', 'finished');
  await sleep(200);
  check(admin.pub!.superlativeResults.length === 6, 'recap has all 6 superlatives');
  check(admin.ideas.every((i) => i.authorNumber != null), 'recap reveals every group');

  // --- reconnect with saved token ---
  const again = await client();
  const hello = await ack(again.s, 'player:hello', { token: players[3].token });
  await until(() => Boolean(again.me), 'rejoined phone gets its group');
  check(hello.mode === 'group' && again.me!.groupId === players[3].groupId, 'phone reload rejoins its group from the saved token');

  for (const c of [admin, outsider, again, ...players]) c.s.close();
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed.');
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
