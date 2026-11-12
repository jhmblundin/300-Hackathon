// Bot groups for testing and dress rehearsals. When the admin starts the game, bots join every group that
// no real phone has joined, then pitch, vote and pick superlatives at human-ish random times.
//   BASE_URL=http://localhost:3000 ADMIN_PASSWORD=... npm run bots
// Real phones join their groups in the lobby first; bots take the rest when you press Start.

import { io, type Socket } from 'socket.io-client';
import { VOTE_KINDS } from '../shared/rules';
import type { MeState, PublicIdea, PublicState } from '../shared/types';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'dev';
const MAX_BOTS = Number(process.env.MAX_BOTS ?? 99);

const IDEAS: [string, string][] = [
  ['LeaseLens', 'Upload your Boston lease and an AI flags every illegal clause, broker fee and missing smoke detector before you sign.'],
  ['Syllabus to Calendar', 'Drop in any syllabus PDF and get every deadline in your calendar in ten seconds.'],
  ['DroneCampfire', 'Autonomous drones that light your campfire from 200 feet up. What could go wrong.'],
  ['VC GPT', 'An AI that writes pitch decks with the words AI, agentic and moat on every slide.'],
  ['RoomieMatch', 'Roommate matching on sleep schedule, dish tolerance and how loud you take calls.'],
  ['ShelfScan', 'Point your phone at a grocery shelf and see the cheapest price per ounce instantly.'],
  ['Office Hours Queue', 'A live queue for TA office hours with ETA texts so nobody waits in a hallway.'],
  ['Thrift Flip AI', 'Snap a thrift find, get a resale estimate and an auto-written listing.'],
  ['ParkPal', 'Predicts which Boston street spots open up next using meter and street-sweeping data.'],
  ['Neighborhood Data Center', 'A data center in every neighborhood, cooled by the community pool.'],
  ['Password Pals', 'Share all your passwords with friends so you never get locked out.'],
  ['MealPrep Swap', 'Cook one big batch, trade portions with five neighbors, eat six different meals.'],
  ['Lab Notebook Copilot', 'Voice-dictate lab notes; it structures them into protocol, results and next steps.'],
  ['CoopFinder', 'Matches co-op candidates to startups on skills, not resume keywords.'],
  ['Sneaker Drop Bot', 'A bot that buys every sneaker drop before humans can. Ethically questionable.'],
  ['QuietHours', 'A noise monitor for dorm halls that pings the loud room before the RA does.'],
  ['Pitch Roast', 'Upload your pitch video and an AI investor roasts it, then tells you how to fix it.'],
  ['Laundry Live', 'Shows which dorm washers are free and texts you when yours is done.'],
  ['Carbon Receipt', 'Every purchase gets a carbon score on your bank statement.'],
  ['Crypto Bake Sale', 'A bake sale where every cookie is an NFT.'],
  ['MoveOut Market', 'Graduating seniors list furniture; incoming freshmen claim it before move-in.'],
  ['FireWatch Mesh', 'Cheap solar sensors that detect wildfire smoke in forests and alert nearby towns.'],
  ['Group Project Ledger', 'Tracks who actually did the work in a group project, with receipts.'],
  ['Hydrant Hotspots', 'Turns every fire hydrant into a public Wi-Fi hotspot.'],
  ['Alumni Coffee Roulette', 'Pairs a student with a random alum for a 20-minute coffee chat every week.'],
  ['Smart Mailbox', 'A mailbox that photographs every package and argues with the courier for you.'],
  ['Gym Crowd Meter', 'Live occupancy for every campus gym, so you never wait for a squat rack.'],
  ['Textbook Tinder', 'Swipe to swap used textbooks with students on your campus.'],
  ['AI Landlord', 'An AI property manager that answers maintenance requests in under a minute.'],
  ['Subway Seat Finder', 'Tells you which train car has open seats before it pulls in.'],
  ['Deepfake Office Hours', 'Your professor, available 24/7, as an AI avatar trained on their lectures.'],
  ['Grill Drone Delivery', 'Hot burgers delivered by drone, straight from a flying grill.'],
  ['Club Fair Copilot', 'Tells freshmen which of 400 clubs to join based on a five-question quiz.'],
  ['Clinic Wait AI', 'Predicts walk-in clinic wait times from check-in data.'],
  ['Open Wi-Fi Bank', 'A bank that runs entirely over public Wi-Fi. No passwords needed.'],
  ['StudyBuddy Radar', 'See who in your class is studying in the library right now and join their table.'],
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)];
let ideaCursor = Math.floor(Math.random() * IDEAS.length);

class Bot {
  pub: PublicState | null = null;
  me: MeState | null = null;
  ideas: PublicIdea[] = [];
  acted = new Set<string>();
  timers: NodeJS.Timeout[] = [];

  constructor(
    public s: Socket,
    public groupNumber: number,
  ) {
    s.on('public', (p: PublicState) => {
      this.pub = p;
      this.react();
    });
    s.on('ideas', (i: PublicIdea[]) => (this.ideas = i));
    s.on('me', (m: MeState) => (this.me = m));
    s.on('released', () => {
      console.log(`[bot G${groupNumber}] released by an admin; stopping`);
      this.timers.forEach(clearTimeout);
      s.close();
    });
  }

  /** Run fn at a random point inside the phase's remaining time (between 5% and 70% of it). */
  later(fn: () => void) {
    const t = this.pub?.timer;
    const remaining = t?.endsAt != null && this.pub ? t.endsAt - this.pub.serverNow : 30_000;
    this.timers.push(setTimeout(fn, rand(0.05, 0.7) * Math.max(remaining, 3000)));
  }

  emit(ev: string, payload: object) {
    return this.s.timeout(5000).emitWithAck(ev, payload).catch(() => ({ ok: false }));
  }

  react() {
    const p = this.pub;
    if (!p || p.locked || !this.me) return;
    const key = `${p.phase}:${p.superlative?.index ?? ''}`;
    if (this.acted.has(key)) return;
    this.acted.add(key);
    const mine = () => new Set(this.me!.ideas.filter(Boolean).map((i) => i!.id));

    if (p.phase === 'submit') {
      for (const slot of [0, 1]) {
        if (this.me.ideas[slot]) continue;
        const [title, description] = IDEAS[ideaCursor++ % IDEAS.length];
        this.later(() => void this.emit('player:saveIdea', { slot, title, description }));
      }
    } else if (p.phase === 'vote') {
      // Wait a beat so the idea list has arrived, then spread votes over the phase.
      setTimeout(() => {
        for (const idea of this.ideas) {
          if (mine().has(idea.id) || this.me!.votes[idea.id]) continue;
          // A little taste: some ideas are crowd favourites or crowd villains.
          const kind = /Lease|Syllabus|Laundry|Office|Gym|Coffee/.test(idea.title)
            ? pick(['rocket', 'rocket', 'rocket', 'meh'] as const)
            : /Drone|Password|Crypto|Hydrant|Open Wi-Fi/.test(idea.title)
              ? pick(['poop', 'poop', 'meh', 'rocket'] as const)
              : pick(VOTE_KINDS);
          this.later(() => void this.emit('player:vote', { ideaId: idea.id, kind }));
        }
      }, 500);
    } else if (p.phase === 'superlatives' && p.superlative) {
      const index = p.superlative.index;
      if (this.me.superlativeVotes[String(index)]) return;
      this.later(() => {
        const options = this.ideas.filter((i) => !mine().has(i.id));
        if (options.length) void this.emit('player:superlativeVote', { index, ideaId: pick(options).id });
      });
    }
  }
}

async function main() {
  const res = await fetch(`${BASE}/ideaathon/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`Admin sign-in failed (${res.status}). Check ADMIN_PASSWORD.`);
  const cookie = res.headers.get('set-cookie')!.split(';')[0];
  const admin = io(BASE, { path: '/ideaathon/socket.io', transports: ['websocket'], extraHeaders: { cookie } });
  let joinCode = '';
  admin.on('admin', (a) => (joinCode = a.joinCode));

  const bots = new Map<string, Bot>();
  let busy = false;
  console.log(`[bots] watching ${BASE}. Bots join the open groups when you press Start.`);

  admin.on('public', async (pub: PublicState) => {
    const live = pub.phase === 'submit' || pub.phase === 'vote' || pub.phase === 'superlatives';
    if (!live || busy || !joinCode) return;
    const open = pub.groups.filter((g) => !g.joined && !bots.has(g.id)).slice(0, Math.max(0, MAX_BOTS - bots.size));
    if (!open.length) return;
    busy = true;
    for (const g of open) {
      const s = io(BASE, { path: '/ideaathon/socket.io', transports: ['websocket'] });
      await new Promise<void>((r) => s.once('connect', () => r()));
      await s.timeout(5000).emitWithAck('player:hello', { code: joinCode });
      const bot = new Bot(s, g.number);
      const claim = await s.timeout(5000).emitWithAck('player:claim', { groupId: g.id, code: joinCode });
      if (claim.ok) {
        bots.set(g.id, bot);
        await s.timeout(5000).emitWithAck('player:hello', { token: claim.token });
      } else s.close();
      await sleep(rand(50, 250));
    }
    console.log(`[bots] playing as ${[...bots.values()].map((b) => `G${b.groupNumber}`).join(' ')}`);
    busy = false;
  });

  process.on('SIGINT', () => process.exit(0));
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
