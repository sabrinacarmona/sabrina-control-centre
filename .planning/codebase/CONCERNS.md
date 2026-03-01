# Codebase Concerns

**Analysis Date:** 2026-03-01

---

## Security Considerations

**No Application-Level Authentication Gate (CONFIRMED CRITICAL):**
- Risk: Any person who navigates to the deployed Railway URL has full read/write access to all personal data — emails, trips, notes, rituals, and calendar events.
- Files: `server.js` (all routes), `client/src/App.jsx` (no auth wall)
- Current mitigation: None. The `AuthContext.jsx` (`client/src/contexts/AuthContext.jsx`) only manages the Google OAuth modal state; it is NOT an access control gate. Any unauthenticated user can call every `/api/*` endpoint directly.
- Recommendation: Add HTTP Basic Auth middleware in `server.js` before any route registration, or a token-based login screen in React that gates the entire app. This must be done before any public deployment.

**`credentials.json` and `token.json` Exist on Disk (Untracked but Present):**
- Risk: Both files exist at the project root (`credentials.json`, 407 bytes; `token.json`, 551 bytes). They contain live Google OAuth credentials and access/refresh tokens.
- Files: `/credentials.json`, `/token.json`
- Current mitigation: Both files are listed in `.gitignore` and do NOT appear in git history. They are not committed.
- Remaining risk: They exist in the local working directory. If the repo is zipped and shared, or if `.gitignore` is accidentally bypassed, they will be exposed. The production path correctly prefers `GOOGLE_TOKEN_JSON` env var over the file; the local dev path reads `token.json` directly from disk.
- Recommendation: Document that `credentials.json` and `token.json` must never be committed. Consider adding a pre-commit hook to reject them.

**`dangerouslyAllowBrowser: true` in Anthropic Client:**
- Risk: The `MailCraft/` standalone app (`MailCraft/src/api.ts`, line 5) initializes the Anthropic SDK with `dangerouslyAllowBrowser: true`, meaning the `VITE_ANTHROPIC_API_KEY` is embedded in the browser bundle and visible to anyone who opens DevTools.
- Files: `MailCraft/src/api.ts`
- Current mitigation: This is the `MailCraft/` subdirectory — a separate, standalone prototype app, not the main `client/` app. The main dashboard routes MailCraft through a server-side SSE endpoint (`/api/mailcraft`) using Gemini, so this is not an active production risk unless the standalone `MailCraft/` app is ever deployed.
- Recommendation: Never deploy the `MailCraft/` standalone app publicly. All AI calls should go through the backend proxy as the main `client/` implementation already does.

**`/api/backup/trigger` Is Publicly Accessible:**
- Risk: Any actor can POST to `/api/backup/trigger` (`server.js`, line 735) and trigger an email of the SQLite database to the authenticated user's Gmail address. While it doesn't exfiltrate data to an attacker, it creates noise and wastes Gmail API quota.
- Files: `server.js` line 735
- Current mitigation: Requires Google OAuth to be configured (backup silently fails without it). No token or rate-limit check on the route itself.
- Recommendation: Once auth is added to the app, gate this endpoint behind the same auth middleware.

---

## Known Bugs

**`DB_PATH` Variable Used But Never Defined (Runtime Error on Backup):**
- Symptoms: The `sendDatabaseBackup` function (`server.js`, lines 676, 677, 687) references `DB_PATH` in three places. This variable is never declared anywhere in `server.js` or any imported module. At runtime, Node.js will throw `ReferenceError: DB_PATH is not defined` the first time a backup is attempted (either via the 3 AM cron or the manual trigger endpoint).
- Files: `server.js` lines 676–687
- Trigger: Any call to `sendDatabaseBackup()` — i.e., the `0 3 * * *` cron job or `POST /api/backup/trigger`
- Workaround: None. The backup feature is currently broken.
- Fix: Define `DB_PATH` near the `TOKEN_PATH` declaration at the top of `server.js` (line 55). The correct value should mirror the Railway environment logic: `const DB_PATH = process.env.RAILWAY_ENVIRONMENT ? '/data/database.db' : path.join(__dirname, 'prisma/database.db');`

**Two `database.db` Files Exist (Ambiguous Truth Source):**
- Symptoms: A `database.db` file exists at the project root (`/database.db`, 61 KB) AND inside the Prisma directory (`/prisma/database.db`, 53 KB). They are different sizes and therefore out of sync.
- Files: `/database.db`, `/prisma/database.db`
- Cause: `DATABASE_URL` in `.env` determines which file Prisma actually uses. The `template.env` references `/data/database.db` for Railway and is silent about the local path. If the local `DATABASE_URL` points to `file:./prisma/database.db`, the root-level `database.db` is a stale artifact from a previous configuration.
- Impact: Developer confusion about which file reflects current data. The broken backup cron would need the correct path to be useful.
- Recommendation: Delete the stale root-level `database.db`. Standardize `DATABASE_URL=file:./prisma/database.db` for local development and document it in `template.env`.

**WebSocket `/ws` Not Proxied in Vite Dev Config:**
- Symptoms: The Vite proxy config (`client/vite.config.js`) only proxies `/api` to `localhost:3000`. The `WebSocketContext.jsx` constructs the WebSocket URL dynamically using `window.location.host`, which in Vite dev is `localhost:5173`. WebSocket connections in dev will attempt to connect to `ws://localhost:5173/ws` and fail, since Vite does not forward WebSocket traffic to the backend.
- Files: `client/vite.config.js`, `client/src/contexts/WebSocketContext.jsx`
- Impact: Real-time trip sync events (`TRIP_SYNC_START`, `TRIP_SYNC_COMPLETE`, `TRIP_SYNC_ERROR`) and the loading spinner in `UpcomingTrips.jsx` will not function during local development. The app degrades gracefully (no crash), but the real-time UX is invisible in dev.
- Fix: Add WebSocket proxy to `vite.config.js`: `'/ws': { target: 'ws://localhost:3000', ws: true }`

**Pomodoro Variable Has a Misleading Name (`isoSevenAuth`):**
- Symptoms: In `server.js` line 950, the variable `isoSevenAuth` holds a date string (`sevenDaysAgo.toISOString()`). This name is a copy-paste artifact from the auth-related patterns in the file and has no relation to authentication.
- Files: `server.js` line 950
- Impact: Readability/confusion only; no functional bug.
- Fix: Rename to `isoSevenDaysAgo`.

---

## Tech Debt

**`server.js` is a 1168-Line Monolith:**
- Issue: The entire backend lives in a single file. It contains: Google OAuth flow, all CRUD endpoints (tasks, notes, rituals, calendar, trips, pomodoros), two AI endpoints (MailCraft SSE, AI scheduling), the Gemini trip parsing engine, WebSocket setup, three cron jobs, the backup function, and the webhook handler. There is no router separation, no service layer, and no controller abstraction.
- Files: `server.js`
- Impact: Adding a new feature requires navigating 1168 lines. Cron jobs are defined inline between route handlers. The `syncTripsForContext` function at line 437 is ~170 lines long. Any modification to one concern risks breaking another.
- Fix approach: Extract into an Express Router structure: `routes/trips.js`, `routes/tasks.js`, `routes/calendar.js`, `routes/mailcraft.js`, `routes/auth.js`. Extract `syncTripsForContext` and `saveGroupedTripsToDb` into `services/tripSync.js`. Move cron jobs to `jobs/cron.js`.

**`@anthropic-ai/sdk` in Root `package.json` is Not Used by the Main App:**
- Issue: `package.json` lists `@anthropic-ai/sdk: ^0.78.0` as a production dependency (line 18). The main backend (`server.js`) does not import it. The Anthropic SDK is used only in `MailCraft/src/api.ts`, which is a separate standalone prototype with its own `MailCraft/package.json`. However, `MailCraft/package.json` does NOT list `@anthropic-ai/sdk` as a dependency — the root `package.json` appears to be serving double duty as the package manifest for both the main app and the `MailCraft/` prototype.
- Files: `package.json` line 18, `MailCraft/src/api.ts` line 1, `MailCraft/package.json`
- Impact: Adds an unused dependency to production deploys. The Handover document correctly states it is inactive in core workflows. The `MailCraft/package.json` is incomplete and the `MailCraft/` directory would fail to build standalone without the root `node_modules`.
- Fix approach: Either move `@anthropic-ai/sdk` to `devDependencies` or remove it from the root and add it to `MailCraft/package.json` as a proper dependency. Clarify whether `MailCraft/` is a separate product or an embedded component.

**Duplicate Deduplication Logic in Two Places:**
- Issue: Trip merging logic is implemented identically in both `utils/deduplication.js` (used during Gemini sync in `syncTripsForContext`) AND inline in the `GET /api/trips` endpoint at `server.js` lines 836–865. The inline version uses a 2-day threshold (matching `utils/deduplication.js`), but is commented as `Hotfix 4.9.2 native 14-day deduplication` — an inaccurate label since the actual threshold is `<= 2` days in both implementations.
- Files: `utils/deduplication.js`, `server.js` lines 836–865
- Impact: Trips are deduped twice: once at save time and once at read time. The two passes are not identical (the read-time version does not check for same TripName before merging). This can produce unexpected merged trip names. The misleading "14-day" comment suggests the threshold was changed at some point and the comment was not updated.
- Fix approach: Remove the inline deduplication from `GET /api/trips` and rely solely on the `utils/deduplication.js` pass that runs during sync. If read-time deduplication is still desired, call the shared `deduplicateTrips()` function rather than duplicating the logic.

**Prompt Schema Mismatch: Gemini Prompt vs. Zod Schema:**
- Issue: The Gemini trip extraction prompt in `server.js` (lines 560–574) instructs Gemini to output fields named `DateTime` and `ConfirmationCode`. The Zod `TripComponentSchema` in `schemas/zodSchemas.js` (lines 3–12) validates for fields named `Date`, `Time`, `Airline`, `FlightNumber`, `Confirmation`, and `Address` — none of which match `DateTime` or `ConfirmationCode`. Gemini responses conforming to the prompt schema will fail Zod validation at `TripsResponseSchema.parse(rawParsedTrips)` (line 589).
- Files: `server.js` lines 560–574, `schemas/zodSchemas.js`
- Impact: Trip sync silently fails (caught by the try/catch at line 601). No trips are saved to the database when Gemini follows the prompt schema. Zod is protecting against corruption, but the mismatch means the sync produces zero results.
- Fix: Align the prompt schema with the Zod schema. Change the prompt's `DateTime` to `Date` and `Time` as separate fields, and `ConfirmationCode` to `Confirmation`. Alternatively, update `zodSchemas.js` to match the prompt — but the prompt must be the source of truth since Gemini responds to it.

**`package.json` `main` Field Points to Nonexistent File:**
- Issue: `package.json` line 6 declares `"main": "test-dashboard.js"`. No file named `test-dashboard.js` exists in the repository. The actual entry point is `server.js`.
- Files: `package.json` line 6
- Impact: The `main` field is only relevant for npm package consumers and `require()` resolution, not for `npm start`. No runtime impact. Misleading to developers reading the manifest.
- Fix: Change to `"main": "server.js"`.

---

## Infrastructure Concerns

**GCP Pub/Sub Webhook Infrastructure Not Configured (Confirmed):**
- Issue: The `/api/webhooks/gmail` route (`server.js` line 635) and the daily `gmail.users.watch()` renewal cron (`server.js` line 615) are fully implemented in code, but the corresponding Google Cloud infrastructure (Pub/Sub topic, IAM permissions, push subscription) has never been created. The `GCP_PROJECT_ID` env var reference at line 627 will resolve to `undefined`, causing the renewal cron to send a malformed topic name to the Gmail API.
- Files: `server.js` lines 615–663
- Impact: Real-time Gmail push notifications are completely non-functional. The system falls back to the hourly polling cron (`0 * * * *`, line 748). This is confirmed by the Handover document.
- Fix: Follow the four-step playbook in the Handover section 7 to configure GCP infrastructure.

**SQLite on Railway with Persistent Volume (Confirmed, with Caveats):**
- Issue: `railway.json` defines a persistent volume at `/data`. The `TOKEN_PATH` logic at `server.js` line 55 correctly uses `/data/token.json` on Railway. However, `DATABASE_URL` is not set conditionally in code — it is read from the environment variable only. If the Railway environment variable `DATABASE_URL` is not manually set to `file:/data/database.db`, Prisma will default to wherever `.env` points (likely `file:./prisma/database.db`), which is ephemeral.
- Files: `railway.json`, `server.js` line 55, `prisma/schema.prisma`
- Impact: Database could be wiped on every Railway deployment if `DATABASE_URL` is not explicitly set in the Railway environment dashboard.
- Recommendation: Add an explicit environment variable assertion at server startup, or add a `DATABASE_URL` default in Railway's dashboard. Document the required value in `template.env`.

---

## Performance Bottlenecks

**N+1 Gmail API Calls During Trip Sync:**
- Problem: `syncTripsForContext` fetches up to 50 email message IDs, then fires a separate `gmail.users.messages.get` request for each one via `Promise.all` (lines 471–484). At 50 messages, this is 51 API calls per sync context. The hourly cron triggers this for both `personal` and `professional`, meaning up to 102 Gmail API calls per hour.
- Files: `server.js` lines 464–484
- Cause: Gmail API `messages.list` returns only message IDs; metadata requires individual fetches. There is no batching.
- Improvement path: Use the Gmail API batch endpoint or reduce `maxResults` to 20. Cache the email metadata with a longer TTL (the inbox cache at line 395 uses 30 seconds; trip emails change rarely and could use 1 hour).

**Hourly Cron + Webhook Both Trigger Full Sync:**
- Problem: Both the hourly cron at `server.js` line 748 and the `POST /api/webhooks/gmail` handler at line 656 call `syncTripsForContext` for both contexts. Once GCP Pub/Sub is configured, every Gmail inbox event will trigger two full Gemini API calls plus 50+ Gmail API calls. The `activeSyncs` Set provides re-entry protection, but not rate limiting.
- Files: `server.js` lines 748–754 and 656–658
- Improvement path: When Pub/Sub is active, disable or lengthen the hourly cron to once per 6 hours. Implement a minimum interval between syncs (e.g., no more than one sync per 5 minutes per context).

---

## Fragile Areas

**`syncTripsForContext` Has No Error Recovery for Partial Failures:**
- Files: `server.js` lines 437–609
- Why fragile: The function deletes all trips for a context at save time (`tx.trip.deleteMany` in `saveGroupedTripsToDb`, line 409) before writing new data inside a transaction. If the Gemini API call fails or Zod validation rejects the response (including due to the prompt/schema mismatch above), `saveGroupedTripsToDb` is never called, so the existing trips remain. However, the `syncTripsForContext` function itself catches errors and broadcasts `TRIP_SYNC_ERROR` without rolling back or retrying. If the Zod parse fails consistently (due to the prompt mismatch), the UI will cycle between showing stale DB data and sync-error events indefinitely.
- Safe modification: Always fix the prompt/Zod mismatch before changing the Gemini prompt. Test with a mock response before deploying prompt changes to production.
- Test coverage: The Jest test suite in `tests/deduplication.test.js` covers only `utils/deduplication.js`. There are no tests for `syncTripsForContext`, `saveGroupedTripsToDb`, Zod validation, or any API endpoint.

**SSE Stream Abort Handler is a No-Op:**
- Files: `server.js` lines 1061–1063
- Why fragile: The `POST /api/mailcraft` SSE endpoint listens for `req.on('close')` but the handler body is empty with a comment: `// connection broke, we can't cleanly abort generator but we can listen`. The Gemini stream continues consuming tokens after the client disconnects. Under the `for await` loop at line 1065, the `if (req.destroyed) break` check provides a soft exit, but the Gemini API call itself is not aborted. This wastes API quota and holds the async iterator open.
- Safe modification: Pass an `AbortController` to the Gemini `generateContentStream` call and call `abort()` in the `req.on('close')` handler.

**WebSocket `broadcastEvent` Called Before Definition:**
- Files: `server.js` lines 446–448 (inside `syncTripsForContext`)
- Why fragile: `syncTripsForContext` is defined at line 437. It calls `broadcastEvent` (defined at line 1157) with a `typeof broadcastEvent === 'function'` guard. In JavaScript (CommonJS, non-strict), function declarations are hoisted, but `broadcastEvent` is defined with the `function` keyword so it IS hoisted. The guard is technically unnecessary but exists as a defensive check. If `server.js` is ever refactored to split files, this implicit dependency on a globally-scoped function will break silently unless the guard is caught by tests.

---

## Test Coverage Gaps

**No API Endpoint Tests:**
- What's not tested: Zero tests for any Express route (`/api/tasks`, `/api/trips`, `/api/notes`, `/api/rituals`, `/api/calendar`, `/api/mailcraft`, `/api/webhooks/gmail`). The `supertest` package is present in `devDependencies` but unused.
- Files: `tests/` (only `deduplication.test.js` exists)
- Risk: Any regression in request handling, Prisma queries, or auth checks goes undetected.
- Priority: High

**No Integration Tests for Zod Validation + Gemini Response Pipeline:**
- What's not tested: The critical path where a Gemini response is received, stripped of markdown fences, JSON-parsed, and Zod-validated. Given the active prompt/schema mismatch (documented above), a test here would have caught the bug.
- Files: `server.js` lines 585–592, `schemas/zodSchemas.js`
- Risk: Silent trip sync failures due to schema drift between prompt and validator.
- Priority: High

**`npm test` Script Does Not Run Tests:**
- What's not tested: `package.json` defines `"test": "echo \"Error: no test specified\" && exit 1"`. The Jest config is in `devDependencies` but there is no `jest.config.*` file and no `test` script that actually invokes Jest. Running `npm test` from the root will always fail.
- Files: `package.json` line 7
- Risk: CI/CD (if added) would always report test failure. Developers following the Handover instruction to "run `npm test` after any modifications" will get a misleading error.
- Fix: Change the `test` script to `"jest"` or `"jest --testPathPattern=tests/"`.

---

## Dependencies at Risk

**`minimatch` ReDoS Vulnerability (High Severity):**
- Risk: npm audit reports one high-severity vulnerability in `minimatch` versions 9.0.0–9.0.6. Two advisories apply: GHSA-7r86-cg39-jmmj (combinatorial backtracking via multiple GLOBSTAR segments) and GHSA-23c5-xmqv-rm74 (nested `*()` extglobs). Both are ReDoS (Regular Expression Denial of Service) vectors.
- Impact: If any user-controlled input reaches a code path that uses `minimatch` for glob matching, an attacker could freeze the Node.js event loop.
- Migration plan: `npm audit fix` is available and should resolve this without breaking changes.

---

*Concerns audit: 2026-03-01*
