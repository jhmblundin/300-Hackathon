import { io } from 'socket.io-client';
const B = 'https://300massave.com';
const mk = () => io(B, { path: '/ideaathon/socket.io', transports: ['polling'] });
const ack = (s: any, ev: string, p: any) => new Promise<any>((r) => s.emit(ev, p, r));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const admin = mk(); let A: any, P: any;
admin.on('admin', (a: any) => (A = a)); admin.on('public', (p: any) => (P = p));
await wait(1500);
console.log('openLobby', (await ack(admin, 'admin:action', { type: 'openLobby' })).ok);
await wait(800);
const phones: any[] = []; const t0 = Date.now();
await Promise.all(Array.from({ length: 50 }, async (_, i) => {
  await wait(i * 60);
  const s = mk(); const me: any = {}; s.on('me', (m: any) => Object.assign(me, m));
  await new Promise((r) => s.on('connect', r));
  const r = await ack(s, 'player:join', { name: `Tester ${i + 1}`, code: A.joinCode });
  if (!r.ok) console.log('join fail', i, r.error);
  phones.push({ s, me, i });
}));
await wait(1500);
console.log(`50 joined in ${((Date.now() - t0) / 1000).toFixed(1)}s; waiting room shows`, A.players.length, '| playerCount', P.playerCount);
console.log('start', (await ack(admin, 'admin:action', { type: 'start' })).ok);
await wait(2500);
console.log('phase', P.phase, 'teams', P.groups.length, 'sizes', P.groups.map((g: any) => g.members.length).join(','), '| submit seconds', P.durations.submitMs / 1000, 'vote seconds', P.durations.voteMs / 1000);
const noTeam = phones.filter((p) => !p.me.groupNumber).length; console.log('phones without a team', noTeam);
// every phone writes its own idea at the same moment
const res = await Promise.all(phones.map((p) => ack(p.s, 'player:saveIdea', { slot: 0, title: `Idea from ${p.i + 1}`, description: '' })));
console.log('ideas saved', res.filter((r) => r.ok).length, '/ 50');
// a late joiner mid-phase gets a team and an EMPTY idea of their own
const late = mk(); const lm: any = {}; late.on('me', (m: any) => Object.assign(lm, m)); await new Promise((r) => late.on('connect', r));
await ack(late, 'player:join', { name: 'Late Larry', code: A.joinCode }); await wait(1500);
console.log('late joiner team', lm.groupNumber, '| their idea box', JSON.stringify(lm.ideas));
await wait(1000);
const own = phones.map((p) => p.me.ideas?.[0]?.title === `Idea from ${p.i + 1}`).filter(Boolean).length;
console.log('phones that see ONLY their own idea in their box', own, '/ 50');
await ack(admin, 'admin:action', { type: 'endTimer' }); await wait(500);
console.log('next', (await ack(admin, 'admin:action', { type: 'next' })).ok); await wait(1500);
console.log('phase', P.phase, 'ideas', P.ideaCount);
const ideas: any[] = await new Promise((r) => { const s = mk(); s.on('ideas', r); s.on('connect', () => ack(s, 'player:hello', {})); });
const kinds = ['star', 'rocket', 'smile', 'confused', 'poop', 'megapoop'];
let ok = 0, own2 = 0; const tv0 = Date.now();
await Promise.all(phones.map(async (p) => {
  for (const idea of ideas.slice(0, 15)) {
    const r = await ack(p.s, 'player:vote', { ideaId: idea.id, kind: kinds[Math.floor(Math.random() * 6)] });
    r.ok ? ok++ : own2++;
  }
  await ack(p.s, 'player:funniest', { ideaId: ideas[(p.i * 7) % ideas.length].id });
}));
await wait(1500);
console.log(`votes ok ${ok}, refused ${own2} (own idea), in ${((Date.now() - tv0) / 1000).toFixed(1)}s | votesCast ${P.votesCast} | funny picks`, Object.values(P.funny ?? {}).reduce((a: number, b: any) => a + b, 0));
console.log('reset', (await ack(admin, 'admin:action', { type: 'resetGame', scope: 'all' })).ok);
await wait(800); process.exit(0);
