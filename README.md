# Rootsapiens HQ

A web app that shows the Rootsapiens AI social media agency team (structure: [docs/company.md](docs/company.md)) as pixel characters in an isometric office,
with live status, streamed chat and Boss delegation. The server is the only source of truth: every
step a character takes comes from a real status event (IDLE, WORKING, THINKING, MEETING, DONE, ERROR).

## Setup (4 steps)

1. Install Node.js 22 or newer.
2. `npm install` (from this folder).
3. `cp .env.example .env`. To use Claude, put your key in `ANTHROPIC_API_KEY` and set `MOCK=0`. To run with fake replies, leave `MOCK=1`.
4. `npm run dev`, then open http://localhost:5173

With no key (or `MOCK=1`) the server runs in **MOCK mode**: fake streamed replies and fake delegation,
shown as a `MOCK` badge in the top bar. Never commit `.env`.

## What you see

- **Office** (PixiJS v8, 2:1 isometric): Command Deck, Engineering, Art Studio, Writers Room, HR,
  Animation Bay, Meeting Room, Pantry and Commons, with **The Brain** orb in the Commons.
- **Motion from state**: IDLE wanders the Pantry/Commons; WORKING/THINKING walks to the desk and types
  with a "..." bubble; MEETING walks to the Meeting Room when the Boss delegates; DONE shows a green
  check for 5 s; ERROR shows a red "!". A* pathfinding on the tile grid, 4-frame walk in 4 iso
  directions, depth sorting by y. The Brain pulses while model calls are in flight.
- **Camera**: drag to pan, wheel or pinch to zoom, click an agent to focus and open its chat, FIT to see everything.
- **Panel**: Roster | Chat (streamed, saved in SQLite, `@name` autocomplete in the Boss chat) | Files | Activity.
- **Files**: agents put every deliverable (draft, script, plan, code, QA report) in a file with `save_file`.
  Reports to the Boss end with the file names, shown as buttons that open the file. The Files tab lists every
  version (newest first, filter by agent) with a read-only viewer and a Download button.
- **Top bar**: working / done / needs-input counters, connection dot, mode badge, global PAUSE (no new jobs start while paused).

## The team (`server/agents.config.ts`, structure in `docs/company.md`)

| Agent | Role | Room | Shirt |
|---|---|---|---|
| Cyrex | CEO, the only one with `assign_task` | Agency Desk | gold |
| Zurub | CSO, Strategy & Research: briefs, calendars, trends | Strategy & Copy | green |
| Nedal | CMO, Content, Copy & Reels: captions, hooks, scripts | Reels Studio | orange |
| Aktham | CCO, Creative: brand kit, AI imagery, carousels | Creative Studio | pink |
| Rajaie | CTO, AI Production & Data: reel specs, scheduling plans, platform | Production & Data | blue |
| Razan | CPO, People & Quality: scored QA gate, onboarding, watchdog | Quality Desk | purple |

Each agent also has skills (playbooks in `skills/`, opened with the `use_skill` tool); see [docs/company.md](docs/company.md#skills). Add one from GitHub with `npm run skills:add -- <repo-url> <path> --agent <id>`.

## Server

- `POST /api/agents/:id/message` `{ "text": "..." }` queues a message (202). `GET /api/agents/:id/messages`, `GET /api/state`, `GET /api/files`, `GET /api/files/:id`, `GET /api/files/:id/download`, `POST /api/pause` `{ "paused": true }`, `GET /api/health`.
- Local only: binds 127.0.0.1 and refuses requests and WS connections from non-localhost Origins.
- WebSocket `/ws`: a `snapshot` first, then events. The contract lives in `shared/events.ts` (zod schemas, no `any`).
- Tools: `assign_task` (Boss only), `use_skill`, `save_file`, `read_file`, `list_files`, `report_result`, `update_status`. One queue per agent; model calls retry with
  exponential backoff (3 retries); a final failure turns the agent ERROR and never crashes the server.
- Storage: SQLite (`better-sqlite3`) at `server/data/hq.sqlite` (git-ignored). Override with `HQ_DB`.
- Env: `ANTHROPIC_API_KEY`, `MODEL` (default `claude-sonnet-5-5`), `MOCK`, `HQ_PORT` (8787), `MEETING_MS` (8000).

MOCK triggers for demos: add `#fail` to a message to make that agent fail all retries (ERROR),
`#flaky` to fail once and recover, `#ask` to finish with "needs input".

## Sprites

Characters are drawn in code (16x24, shirt tinted with the agent colour). To replace one, drop a
64x72 sheet at `web/public/sprites/<agentId>.png`; the layout is in `web/public/sprites/README.md`.

## Checks

- `npm run check`: TypeScript strict on every package, then vitest (state machine, A* and map, WS contract, mock end-to-end).
- `npm run e2e`: Playwright against `npm run dev` in MOCK mode; screenshots go to `docs/screenshots/`.

## Go live (public URL)

One container serves the web app, the API and the WebSocket. Visitors watch the office live; only the owner can
sign in (top-right, "Owner sign in") to talk to the team, pause, and read chats and files.

1. Push this repo to GitHub.
2. On [Render](https://render.com): New -> Blueprint -> pick the repo (it reads `render.yaml`).
3. Fill in `HQ_OWNER_TOKEN` (your owner password, 16+ characters) and `ANTHROPIC_API_KEY`
   (leave empty for a MOCK demo that costs nothing).
4. Open the `*.onrender.com` URL and share it.

Any host that runs a Dockerfile works the same way (Railway, Fly.io, a VPS: `docker build -t hq . && docker run -p 8787:8787 -v hq-data:/data -e HQ_OWNER_TOKEN=... hq`).

| Env | Meaning |
|---|---|
| `HQ_OWNER_TOKEN` | Turns on public mode. Required to listen on anything but 127.0.0.1. |
| `HQ_PUBLIC_DETAIL` | `office` (default): visitors see the office and statuses only. `full`: visitors also read chats, activity and files (never act). |
| `HQ_HOST` / `PORT` | Set by the Dockerfile / the host. |
| `HQ_STATIC_DIR` | Folder with the built web app (`npm run build` -> `web/dist`). |

Cost guard: with a real `ANTHROPIC_API_KEY`, only the signed-in owner can start work, so visitors cannot spend your key.
