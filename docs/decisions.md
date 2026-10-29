# HQ decisions (made without the owner, cheapest to undo)

Format: date - decision - why - how to undo.

- 2026-10-29 - No API key means MOCK mode automatically (badge "MOCK" in the top bar), not an error screen - the app works out of the box and the badge makes the mode obvious - set `MOCK=0` and a key in `.env`; or change the `mockFlag || !apiKey` line in `server/src/index.ts`.
- 2026-10-29 - Nedal is in the HQ roster as the owner's spec lists him (he is an active agent file in `.claude/agents/`) - spec order - remove his entry from `server/agents.config.ts`.
- 2026-10-29 - Decisions log kept in `hq/docs/` rather than `studio/decisions.md` - the order limited all writes to `hq\` - move the lines.
- 2026-10-29 - All delegations in one Boss turn share one meeting (8 s, `MEETING_MS`) - agents need time to walk to the Meeting Room, and one meeting per batch keeps the Boss from stalling - set `MEETING_MS`.
- 2026-10-29 - "Done" counter counts finished jobs (persisted), "needs input" counts agents in ERROR or that reported `needs_input` - the DONE status itself only lasts 5 s - change `TopBar` in `web/src/App.tsx`.
- 2026-10-29 - Global pause stops new jobs from starting; a job already streaming finishes - cutting a stream mid-reply would lose work - change `pump()` in `server/src/hq.ts`.
- 2026-10-29 - Tool-use turns are not stored, only chat text; history sent to the model is the last 30 text messages per thread - keeps the DB and token use small - raise `historyLimit` in `Hq`.
- 2026-10-29 - npm 11 `allowScripts` approves the install scripts of `better-sqlite3` (native binary) and `esbuild` only - needed to load SQLite - remove the entries in `package.json`.
- 2026-10-29 - `@playwright/test` pinned to 1.56.1 to reuse the Chromium already on this machine (no browser download) - upgrade any time with `npx playwright install`.
