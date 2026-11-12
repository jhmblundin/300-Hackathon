# 300 AI Hackathon · Idea Board

A live, Kahoot-style mini-game for the 300 AI Hackathon kickoff. Random groups of 4 pitch startup ideas from one
phone per group, rate every other group's ideas with 🚀 / 😐 / 💩, then vote on six superlatives. A projector screen
shows everything live.

| Who | URL | What |
|---|---|---|
| Groups (one phone each) | `/` (via the QR code) | Join a group, pitch, vote |
| Projector | `/screen` | QR lobby, live idea wall, live leaderboard, superlative reveals, recap |
| Jack & Sean | `/admin` | Paste names, generate groups, start/advance the game, timers, moderation |

`/screen` and `/admin` need an admin passcode.

## How the game runs

1. **Generate groups** (admin → *Generate groups*). Paste the participant list (one name per line, spreadsheet
   paste is fine) → **Save list** → **Generate random groups**. 62 people → 14 groups of 4 + 2 of 3. Reshuffle as
   often as you like until you press Start.
2. **Lobby.** Put `/screen` on the projector. People scan the QR code, search their name, tap their group. The
   first phone to tap a group owns it; nobody else can join as that group (admin can *Release phone*).
3. **Phase 1 · Pitch (3 min).** Each group writes 2 ideas: a title + up to 200 words. Autosaves. Titles pop onto
   the big screen as they come in (anonymous).
4. **Phase 2 · Vote (3 min).** Each group gives every *other* group's idea one 🚀 (+1), 😐 (0) or 💩 (−1). One vote
   per idea, no take-backs, no voting on your own. The leaderboard re-sorts live on the projector and phones.
   When time's up, the winner (and its group) is revealed with confetti. Tap it to read the description out loud.
5. **Phase 3 · Superlatives (1 min each × 6).** Each group picks one idea (not their own) per superlative. Results
   stay hidden until the minute is up, then the winner and top 3 are revealed.
6. **Recap.** Top idea + all six superlative winners, with every group revealed.

The admin moves the game along: when a timer hits 0, phones lock automatically and **Next** appears. Admins can
also pause/resume, add 30 s / 1 min (which also reopens a phase whose time is up), end a timer early, remove an
idea, or *Spotlight* one on the projector.

## Deploy on Railway (Sean)

1. **New Project → Deploy from GitHub repo →** `jhmblundin/300-Hackathon`. Railway reads `railway.json`
   (build `npm run build`, start `npm start`, health check `/healthz`).
2. **Add a database:** in the project, **+ New → Database → PostgreSQL**. It's what lets a restart or redeploy
   mid-game resume exactly where it was.
3. **Service → Variables** (see `.env.example`):
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`
   - `ADMIN_JACK_PASSWORD` = a passcode for Jack (10+ chars)
   - `ADMIN_SEAN_PASSWORD` = a passcode for Sean (10+ chars)
   - `SESSION_SECRET` = 32+ random characters (`openssl rand -hex 32`)
4. **Settings → Networking → Generate Domain.** That URL is what the QR code points at.
5. Keep it at **1 replica** (the game lives in one process; Postgres is the backup copy).
6. Check `https://<domain>/healthz` says `"storage":"postgres"`, then sign in at `/admin`.

Each `ADMIN_<NAME>_PASSWORD` variable adds an admin named `<Name>`. With none set in production, nobody can sign in.

## Day-of checklist

- [ ] `/healthz` shows `postgres`; both admins can sign in.
- [ ] Participant list saved, groups generated, the projector shows `/screen` in full screen (⛶).
- [ ] One test phone joins, then *Release phone* it before the real start.
- [ ] Wi-Fi is fine for 16 phones (cell data works too; the app is ~170 KB).

## Develop

```bash
npm install
npm run dev        # http://localhost:3000, admin passcode "dev" (dev only)
npm test           # engine rules (vitest)
npm run typecheck
```

Full rehearsal (16 simulated phones + admin, against any running server):

```bash
SUBMIT_SECONDS=6 VOTE_SECONDS=6 SUPERLATIVE_SECONDS=3 ADMIN_JACK_PASSWORD=test-pass-123 npm start   # after npm run build
BASE_URL=http://localhost:3000 ADMIN_PASSWORD=test-pass-123 npm run simulate
```

## How it's built

- **Vite + React + TypeScript** for the client; one **Node/Express + Socket.IO** server serves the built app and
  pushes live updates. Broadcasts are coalesced (≤10/s) so 16 phones voting at once stays cheap.
- `server/game.ts` is the whole rulebook (phases, timers, one-phone-per-group, no self-votes, one vote per idea,
  200-word cap, hidden superlative tallies, author reveal). Every rule is enforced on the server; the client only
  displays. `shared/rules.ts` holds the constants and scoring used by both.
- **Timers are server-side** (absolute end times), so every screen counts down together and a refresh can't cheat.
- **Saved** to Postgres (`hackathon_game_state`, one JSON row) on every change, or to `./data` locally.

### Security

- The repo is public: **no participant names, passcodes or secrets in git.** Names live only in the database.
- Admin passcodes are compared in constant time; sessions are signed httpOnly, SameSite=Strict cookies; failed
  sign-ins are rate-limited. Sockets from other origins are refused.
- Joining needs the 5-letter code from the QR/screen, so the URL alone shows nothing (not even names).
- Each group phone gets a random token (only its hash is stored). Ideas stay anonymous to phones until revealed.

### Brand

The 300 core mark (`client/public/brand/`, approved by Northeastern marketing) on Cool Black `#1E2028`, Canvas
`#F6F6F4` and Northeastern Red `#C8102E` (`#F14C66` for small red text on dark). Type is FF Real Head Pro, loaded
from scion.events like the 300 site (licensed to Northeastern, so the font files are not in this repo). It falls back
to Helvetica Neue.
