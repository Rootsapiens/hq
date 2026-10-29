# HQ: Creative Studio office

A local web app that shows the Creative Studio agents as pixel characters in an isometric office,
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
- **Panel**: Roster | Chat (streamed, saved in SQLite, `@name` autocomplete in the Boss chat) | Activity.
- **Top bar**: working / done / needs-input counters, connection dot, mode badge, global PAUSE (no new jobs start while paused).

## The team (`server/agents.config.ts`)

| Agent | Role | Room | Shirt |
|---|---|---|---|
| Cyrex | Boss / Chief of Staff, the only one with `assign_task` | Command Deck | gold |
| Rajaie | Head of IT, code and QA | Engineering | blue |
| Aktham | Art, sound, video, ChatGPT art | Art Studio | pink |
| Zurub | Business, scripts, story | Writers Room | green |
| Razan | HR and watchdog | HR | purple |
| Nedal | Animator in 7rrek | Animation Bay | orange |

System prompts are short summaries of the agent files; the agent files themselves are not read at runtime.

## Server

- `POST /api/agents/:id/message` `{ "text": "..." }` queues a message (202). `GET /api/agents/:id/messages`, `GET /api/state`, `POST /api/pause` `{ "paused": true }`, `GET /api/health`.
- Local only: binds 127.0.0.1 and refuses requests and WS connections from non-localhost Origins.
- WebSocket `/ws`: a `snapshot` first, then events. The contract lives in `shared/events.ts` (zod schemas, no `any`).
- Tools: `assign_task` (Boss only), `report_result`, `update_status`. One queue per agent; model calls retry with
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
