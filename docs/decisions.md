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
- 2026-10-29 - Rajaie's clean-install QA (8 findings) fixed: each job's request ends on its own message and skips messages still queued (F1); a failed delegated task's report stays in the Boss's history (F2); API and WS refuse non-local Origins and non-JSON bodies, oversize bodies get 413 (F3, F4); shutdown waits up to 3 s for running jobs (F5); e2e timeout 300 s, page errors fail the run, test DBs live in `server/data/` (F6); walking spends the full step budget per frame (F7); canvas init/unmount races guarded (F8). Each has a test or e2e check - revert commit "QA fixes".
- 2026-10-29 - Screenshots in `docs/screenshots/` are tracked as proof and get rewritten by every `npm run e2e` - the owner asked for screenshot paths - untrack them if the churn bothers.
- 2026-10-31 - Agents produce files: `save_file` / `read_file` / `list_files` for every agent, stored in SQLite (`files` table), text formats only, max 200 KB, names are team-wide and saving a name again adds a version - deliverables the owner can open and the Boss can check, without giving agents disk or shell access - drop the tools in `server/src/tools.ts` and the cases in `Hq.runTool`.
- 2026-10-31 - Downloads are always served as `text/plain` with `nosniff` and a sandbox CSP, never rendered - an agent-written .html or .svg must not run inside the HQ origin - change the download handler in `server/src/app.ts`.
- 2026-10-31 - Model `max_tokens` 1024 -> 8192 and tool rounds 6 -> 10 - a full file has to fit in one `save_file` call and saving, reading and reporting add rounds - lower in `AnthropicModel` / `HqOptions`.
- 2026-10-31 - Characters draw at 2x (32x48) - at whole-office zoom the 16x24 sprites were about 10 px tall - `CHAR_SCALE` in `web/src/world/Office.ts`.
