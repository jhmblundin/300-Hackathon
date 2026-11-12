# HANDOFF: deploy the Idea Board (for Sean's agent)

## Status from Sean's agent (2026-11-12, 6:20pm, verified live) — read first, Jack

**Live:** `https://300massave.com/ideaathon` (phones) and `https://300massave.com/ideaathon/presentation` (projector).
300massave.com (Vercel) proxies `/ideaathon/*` to the Railway service `web` in Sean's Railway project `ideaathon`
(`https://web-production-f022cd10.up.railway.app/ideaathon`, with Postgres). Admin is `/ideaathon/admin`. Sean has
both passcodes and will send you yours.

**What changed in the code (commit "Serve under /ideaathon"):** the whole app now lives under `/ideaathon`
(Vite `base`, router `basename`, API at `/ideaathon/api/…`, Socket.IO path `/ideaathon/socket.io`, `/` redirects
there). `/presentation` is the same page as `/screen`. Sockets from `300massave.com` are allowed
(`ALLOWED_ORIGIN_HOSTS`). Vercel's proxy can't carry WebSockets, so phones on 300massave.com use long-polling;
`pingInterval` is 10 s to keep polls short. `npm run simulate` / `bots` take `BASE_URL=https://<host>` (no path).

**Deploys don't follow pushes yet.** Railway's GitHub app can't see `jhmblundin/300-Hackathon`, so the service was
deployed by `railway up` from a clean `git archive`. After you push, ask Sean's agent to redeploy, or connect the repo
in Railway (Service → Settings → Source) if you can.

**Phase lengths in production:** `SUBMIT_SECONDS=60`, `VOTE_SECONDS=120` (Sean). Superlatives stay 60 s.

### Built at 7pm on 2026-11-12 (Sean's agent): the Kahoot-style flow

- **`/ideaathon/admin` is the TV screen and has the controls** (same as `/presentation`); the old tabbed console moved
  to `/ideaathon/console`. `ADMIN_OPEN=true` on Railway turns off the passcode (Sean's call).
- **Flow:** Start game → waiting room with the QR, the code and the names as they join → **Start the game** makes
  random teams of 4 from everyone who joined and starts Phase 1 → **Next phase** on the same screen flips every phone.
- **Phones:** open the link, type a name (and the code if they didn't scan) → a new player every time. Late joiners go
  to the smallest team. State: `players` (participantId → token hash); `votes` and `superlativeVotes` are keyed by
  player now (one vote per person, never on your own team's idea).
- **Phase 1:** 3 ideas per team, a title is enough (description optional). Teammates share the 3 slots, so two
  people editing the same slot overwrite each other; the screen tells them to take one each.
- **To do for Jack's agent:** two engine tests in `tests/game.test.ts` still use the old one-phone-per-group claim flow
  and are skipped (`it.skip`); rewrite them for players. `scripts/simulate.ts` and `scripts/bots.ts` also still use
  `player:claim` and won't work until updated.

---

*Written 2026-11-12 by Jack's agent. Owner of the deploy: Sean. Admins: Jack and Sean.*

## Why this exists

The first activity at the 300 AI Hackathon is a Kahoot-style idea game. All 62 participants get split into random
groups of 4. Each group uses one phone (they join by scanning a QR code on the projector) to pitch 2 startup ideas.
Then every group rates every other group's ideas with 🚀 / 😐 / 💩 while the leaderboard reshuffles live on the
projector. Last come 6 one-minute superlative votes. The app is **built, tested and on `main`**. What's left is to
**deploy it on Railway, verify it live, and hand Jack the URL and his passcode**. No code changes should be needed.

Read `README.md` for the game rules and design. This file covers getting it live.

## Current state (verified before handoff)

- `main` builds clean: `npm ci --omit=dev && npm run build` (the build tools are in `dependencies` on purpose).
- 13 engine tests pass (`npm test`). Typecheck is clean (`npm run typecheck`).
- `npm run simulate` (an admin plus 16 simulated phones playing a full game) passed all 56 checks, on both file
  storage and Postgres. A restart mid-game resumed exactly where it left off.
- Every screen was checked in a browser at phone (390×844) and projector (1600×900) sizes.
- `npm run bots` (fake groups for a one-person dress rehearsal) was tested against a local server.

## Deploy on Railway

`railway.json` already sets the build (`npm run build`), start (`npm start`) and health check (`/healthz`).

1. Accept the GitHub invite to `jhmblundin/300-Hackathon`. Railway needs to see the repo.
2. Railway → **New Project → Deploy from GitHub repo → `jhmblundin/300-Hackathon`**, branch `main`. This makes
   every push to `main` redeploy automatically.
3. In the same project: **+ New → Database → PostgreSQL**.
4. On the app service → **Variables**:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (reference variable) |
   | `ADMIN_JACK_PASSWORD` | a fresh random passcode, 10+ characters |
   | `ADMIN_SEAN_PASSWORD` | a fresh random passcode, 10+ characters |
   | `SESSION_SECRET` | `openssl rand -hex 32` |

   Leave `SUBMIT_SECONDS` / `VOTE_SECONDS` / `SUPERLATIVE_SECONDS` unset in production (defaults 180 / 180 / 60).
5. **Settings → Networking → Generate Domain.** The QR code is built from whatever host serves `/screen`, so a
   custom domain works too, as long as the projector opens `/screen` on that same domain.
6. Keep **1 replica**. The game lives in one process, with Postgres as its saved copy. More than one replica would
   split the game across copies.

CLI alternative (Railway CLI v3+, if the dashboard isn't handy): `railway login`, `railway init`,
`railway add --database postgres`, `railway variables --set "KEY=value"` for each row above (with `DATABASE_URL`
as `${{Postgres.DATABASE_URL}}`), `railway up`, `railway domain`. Prefer the GitHub deploy so pushes redeploy.

## Verify it live (do all of these)

1. `curl https://<domain>/healthz` returns `{"ok":true,"phase":"setup","storage":"postgres"}`. If it says
   `"file"`, `DATABASE_URL` isn't reaching the service, and a redeploy would wipe the game.
2. `https://<domain>/admin`: sign in with each passcode (Jack and Sean). A wrong passcode is refused.
3. Full-game rehearsal against the live app, from a checkout of this repo:
   ```bash
   npm ci
   BASE_URL=https://<domain> ADMIN_PASSWORD=<Sean's passcode> npm run simulate
   ```
   Expect `All checks passed.` It plays the 6 superlatives at full length (1 min each) unless you lower the phase
   lengths. To get a fast run, temporarily set `SUBMIT_SECONDS=10 VOTE_SECONDS=10 SUPERLATIVE_SECONDS=5`, redeploy,
   run it, then **delete those variables and redeploy again**. The simulator uses fake names and resets the game.
4. Restart test: Railway → service → **Restart**. `/healthz` comes back with the same `phase` as before.
5. **Reset afterwards:** `/admin` → Game → Danger zone → **Reset everything**. This clears the fake groups and
   names from the rehearsal.

## Hand over to Jack

- Send Jack the URL and **his** passcode privately (text/DM). **Never** commit passcodes or put them in the shared
  context repo.
- The real participant list (62 names) comes from Jack. It gets pasted into `/admin` → **Generate groups** →
  **Save list** → **Generate random groups**. It must **never** go into this repo, which is public.
- In `seanblundin/300massave-private-agent-context`: remove the "Deploy the kickoff Idea Board on Railway" item under
  Sean in `board.md`, and log the deploy in `logs/sean.md` (newest first:
  `- YYYY-MM-DD: what, files, why (who asked).`). Follow that repo's `AGENTS.md`.

## Day-of runbook (for Jack and Sean)

1. Sign in at `/admin`. Paste the names, then generate groups (reshuffling is fine until Start).
2. Projector: open `/screen` on the **same domain**, sign in, then click ⛶ for full screen. It shows the QR code,
   the 5-letter join code, and groups lighting up as they join.
3. Groups scan, search a name, tap their group. If a group grabbed the wrong one: Generate groups tab →
   **Release phone**.
4. **Start the game** → when each timer hits 0, phones lock and **Next** appears. Also available: **Pause**,
   **+30 s** (reopens a phase whose time is up), **End timer now**, Ideas tab → **Spotlight** / **Remove**.
5. Restarting: **Restart game (keep groups)**, or **Reset everything**.
6. Optional solo dress rehearsal: `BASE_URL=https://<domain> ADMIN_PASSWORD=... npm run bots`. Join from your own
   phone first; bots take the other groups when you press Start. Stop the bots and **Reset everything** before the
   real run. Never leave bots running during the event.

## Troubleshooting

- **Build fails on Node version:** the app needs Node ≥ 22.12 (`engines` in `package.json`; Vite 8). If Railway
  picks an older Node, set `RAILPACK_NODE_VERSION=22` (or `NIXPACKS_NODE_VERSION=22` on the older builder) and
  redeploy.
- **Health check fails:** check the deploy logs for `[server] listening on :<PORT>`. The server reads Railway's
  `PORT`. A `[store]` error means Postgres isn't reachable. If you connect over Railway's public TCP proxy instead of
  the private URL, set `PGSSL=true`.
- **Admin sign-in fails everywhere:** the log shows `admins: none`, meaning the `ADMIN_<NAME>_PASSWORD` variables
  are missing or empty. With none set, production refuses all sign-ins on purpose.
- **Signed out after each redeploy:** `SESSION_SECRET` is missing or shorter than 32 characters.
- **Phones say "code doesn't match":** they opened a URL from a different deploy or domain. Re-scan the QR on
  `/screen`.
- **Font looks like Helvetica:** FF Real Head Pro loads from `scion.events/300-hackathon/a/fonts/` (licensed to
  Northeastern, so it's not in this repo). If scion.events is down, it falls back to Helvetica on purpose.

## Map of the code (if something must change)

- `server/game.ts`: every rule (phases, timers, one phone per group, no self-votes, one vote per idea, 200-word
  cap, hidden superlative tallies, revealing groups). Pure and unit-tested in `tests/game.test.ts`.
- `server/index.ts`: Express + Socket.IO, admin sign-in, live broadcasts, server-side timers, saving the game.
- `server/store.ts`: Postgres (table `hackathon_game_state`, one JSON row) or a local file.
- `server/auth.ts`: one passcode per admin from env, signed cookie sessions, rate limits.
- `shared/rules.ts`: the superlatives list, limits, scoring (🚀 +1, 😐 0, 💩 −1), group sizes.
- `client/src/pages/`: `Play.tsx` (phones), `Screen.tsx` (projector), `Admin.tsx`.
- Before pushing any change: `npm run typecheck && npm test && npm run build`, then `npm run simulate` against a
  local `npm start`.

## Rules

- **Public repo:** no participant names (not even in tests), passcodes, `.env` files or font files.
- Brand comes from the private context repo's `REGISTRY.md`. Only the core 300 mark is used, because the
  "300 Hackathon / Nov 2026" mark's web use is still pending. Colors: Cool Black `#1E2028`, Canvas `#F6F6F4`,
  Northeastern Red `#C8102E` (`#F14C66` for small red text on dark).
- Don't scale past 1 replica, and don't switch to serverless hosting (e.g. Vercel). The app needs one always-on
  process for live sockets and timers.
