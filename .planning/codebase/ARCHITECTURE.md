# Architecture

**Analysis Date:** 2026-03-01

## Pattern Overview

**Overall:** Monolithic backend + SPA frontend (separate processes, same repo)

**Key Characteristics:**
- Single `server.js` file (1168 lines) handles all concerns: REST API, WebSockets, cron jobs, OAuth, AI processing, and database access
- React/Vite SPA in `client/` is a fully separate Node project that proxies `/api` to the Express server in dev
- Context Engine: a single `context` query parameter (`personal` | `professional` | `both`) threads through every API call and every Prisma query, filtering data at the DB layer
- AI pipeline: Gemini 2.5 Flash processes raw Gmail/Calendar data into structured JSON → Zod validates → JS deduplicates → Prisma persists
- Real-time updates: backend emits WebSocket events (`TRIP_SYNC_START`, `TRIP_SYNC_COMPLETE`, `TRIP_SYNC_ERROR`); frontend `useDataFetch` hook listens and auto-refetches

## Layers

**Frontend (Presentation):**
- Purpose: Renders the dashboard UI; manages context toggle state
- Location: `client/src/`
- Contains: React components, one custom hook, two contexts, one utility
- Depends on: Express backend via `fetch` proxied through Vite dev server; WebSocket at `/ws`
- Used by: End user browser

**Frontend Hook Layer:**
- Purpose: Abstracts all data fetching, polling, auth error handling, and WebSocket-triggered refetches into a single reusable hook
- Location: `client/src/hooks/useDataFetch.js`
- Pattern: `useDataFetch(endpoint, context, intervalMs?)` — wraps `fetchWithAuth` from `client/src/utils/api.js`; calls `requireAuth()` on 401-equivalent responses; calls `refetch()` on matching WebSocket events
- Used by: Every data-displaying component (`Calendar.jsx`, `UpcomingTrips.jsx`, `KanbanBoard.jsx`, `DailyRituals.jsx`, `QuickNotes.jsx`, `FocusHeatmap.jsx`, `ActionableInbox.jsx`)

**Context Propagation:**
- Purpose: The `context` state (`'both'`, `'personal'`, `'professional'`) is owned by `App.jsx` and passed as a prop to every widget component. Components pass it to `useDataFetch`, which appends `?context=<value>` to every API request. The backend reads `req.query.context` and uses it in Prisma `where` clauses.
- Entry: `client/src/App.jsx` line 17: `const [context, setContext] = useState('both')`
- Toggle UI: `client/src/components/Header.jsx` renders the Professional/Personal pill buttons

**Backend (Monolith):**
- Purpose: All server logic — routes, auth, AI, cron, WebSocket, DB
- Location: `server.js` (root)
- Contains: Express route handlers, Google OAuth helpers, Gemini AI integration, cron schedules, WebSocket broadcast, Nodemailer backup
- Depends on: `prisma/schema.prisma` (SQLite), `schemas/zodSchemas.js`, `utils/deduplication.js`

**Database Layer:**
- Purpose: Persistence via Prisma ORM over SQLite
- Location: `prisma/schema.prisma`, runtime DB at `database.db` (root, dev) or `/data/database.db` (Railway production)
- Client: `PrismaClient` instantiated once at top of `server.js`, used inline in every route handler — no repository abstraction layer

**Validation Layer:**
- Purpose: Validates Gemini AI JSON output before it is persisted
- Location: `schemas/zodSchemas.js`
- Exports: `TripsResponseSchema`, `TripSchema`, `TripComponentSchema`
- Used by: `syncTripsForContext()` in `server.js` line 589

**Utility Layer:**
- Purpose: Pure functions extracted from server logic
- Location: `utils/deduplication.js`
- Exports: `deduplicateTrips(parsedTrips)` — merges trips within 2-day gaps, deduplicates components by name
- Used by: `syncTripsForContext()` in `server.js` line 592, and also inline (duplicated) logic in the `GET /api/trips` route for `context === 'both'`

## Data Flow

**Trip Sync Pipeline (async background):**

1. Trigger: cron every hour, `POST /api/trips/sync`, or `POST /api/webhooks/gmail` (Google Pub/Sub)
2. `syncTripsForContext(context)` checks `activeSyncs` mutex Set to prevent duplicate runs
3. Broadcasts `TRIP_SYNC_START` via WebSocket to all connected clients
4. Fetches Gmail (travel-keyword search, `newer_than:180d`, max 50) + Google Calendar (travel keyword filter, next 90 days)
5. Sends combined raw data to Gemini 2.5 Flash with structured JSON prompt
6. Response text stripped of markdown, parsed as JSON
7. Validated with `TripsResponseSchema.parse()` (Zod)
8. Deduped with `deduplicateTrips()` (2-day proximity merge)
9. Written to DB via `saveGroupedTripsToDb(context, trips)` — full delete-and-replace for that context using Prisma transaction
10. Broadcasts `TRIP_SYNC_COMPLETE` or `TRIP_SYNC_ERROR`
11. Frontend `useDataFetch` hook detects `TRIP_SYNC_COMPLETE` and refetches `GET /api/trips`

**Standard API Read Flow:**

1. Component mounts → `useDataFetch(endpoint, context)` fires `fetchWithAuth(endpoint, context)`
2. `GET /api/<endpoint>?context=<value>` hits Express
3. Express reads `req.query.context`, queries Prisma with `where: { contextMode: { in: [context, 'both'] } }` (or `where: { contextMode: context }` for some routes)
4. Returns JSON; component renders

**MailCraft AI Flow (SSE streaming):**

1. User submits draft text + tone in `client/src/components/MailCraft.jsx`
2. `POST /api/mailcraft` sets `Content-Type: text/event-stream`
3. `ai.models.generateContentStream()` called with Gemini 2.5 Flash
4. Each chunk written as `data: {"text": "..."}` SSE event
5. Terminates with `data: [DONE]`

**State Management:**
- Frontend state is entirely local React `useState` within components and `App.jsx`
- No global client-side state store (no Redux, Zustand, etc.)
- Auth state managed by `client/src/contexts/AuthContext.jsx` (`isAuthModalOpen`, `authStatus`)
- WebSocket state managed by `client/src/contexts/WebSocketContext.jsx` (`latestEvent`, `isConnected`)

## Key Abstractions

**`useDataFetch` Hook:**
- Purpose: Universal data-fetching hook for all backend reads
- Location: `client/src/hooks/useDataFetch.js`
- Pattern: Returns `{ data, isLoading, error, setData, refetch }`; handles auth errors by calling `requireAuth()`; listens to WebSocket `latestEvent` and auto-refetches on matching event types

**`syncTripsForContext(context)`:**
- Purpose: The entire AI trip-parsing pipeline in one function
- Location: `server.js` line 437
- Pattern: Mutex-guarded async function; broadcasts lifecycle events via `broadcastEvent()`

**`broadcastEvent(type, payload)`:**
- Purpose: Sends JSON message to all connected WebSocket clients
- Location: `server.js` line 1157
- Pattern: Iterates `wss.clients`, sends only to `OPEN` sockets

**`getOAuth2Client()`:**
- Purpose: Returns a configured Google OAuth2 client by reading token from env var (`GOOGLE_TOKEN_JSON`) or file (`token.json`)
- Location: `server.js` line 93
- Used by: Every route that calls Google APIs (Gmail, Calendar)

**Context Engine:**
- Purpose: Partitions all user data into Personal / Professional / Both namespaces
- Implementation: `contextMode` column on `Task`, `Ritual`, `Note`, `Trip` Prisma models; query param `?context=` on every API call; Prisma `where: { contextMode: { in: [context, 'both'] } }` filter pattern
- Note: `Pomodoro` model has NO `contextMode` column — it is context-blind

## Entry Points

**Backend Server:**
- Location: `server.js` line 1166 — `server.listen(PORT, '0.0.0.0')`
- Triggers: `npm run server` or `npm start`
- Responsibilities: Registers all routes, starts cron jobs, starts WebSocket server, seeds rituals on cold start

**Frontend SPA:**
- Location: `client/src/main.jsx` — `createRoot(document.getElementById('root')).render(<App />)`
- Triggers: `npm run client` (Vite dev server) or served as static build
- Responsibilities: Mounts React tree under `AuthProvider` → `WebSocketProvider` → `App`

**Development Orchestrator:**
- Location: `package.json` root — `"dev": "concurrently \"npm run server\" \"npm run client\""`
- Vite proxy: `client/vite.config.js` proxies `/api` → `http://localhost:3000`; WebSocket at `/ws` is NOT explicitly proxied in vite config — relies on `window.location.host` routing logic in `WebSocketContext.jsx`

## Error Handling

**Strategy:** Ad-hoc try/catch in every route handler; no centralized error middleware

**Patterns:**
- All route handlers catch with `catch (e) { res.status(500).json({ error: e.message }); }`
- Google API errors surface a `requiresAuth: true` flag on the response JSON when the error message includes `'authenticate'`, `'credentials.json'`, or `'refresh token'`
- Frontend `fetchWithAuth` detects `data.requiresAuth === true` and throws `{ requiresAuth: true }` which `useDataFetch` catches and routes to `requireAuth()` → opens `AuthModal`
- WebSocket sync errors broadcast `TRIP_SYNC_ERROR` event but do not surface to UI beyond that

## Cross-Cutting Concerns

**Logging:** `console.log` / `console.error` throughout `server.js`; structured prefix convention: `[Trip Sync]`, `[Cron]`, `[Webhook]`, `[Backup]`, `[WebSocket]`

**Caching:** `node-cache` instance (`apiCache`) used only for `GET /api/calendar` (5-minute TTL, keyed by `calendarData_${context}`) and `GET /api/inbox` (30-second TTL). No caching on other routes.

**Validation:** Only on Gemini AI output (`schemas/zodSchemas.js`). No request body validation on standard CRUD routes.

**Authentication:** Google OAuth2 only. Token stored in `token.json` (dev) or `GOOGLE_TOKEN_JSON` env var (Railway). Auth state shown in frontend header via `AuthContext`. No user auth system — this is a single-user personal dashboard.

**Database Backups:** Cron at 3 AM daily emails SQLite file as attachment to user's own Gmail via Nodemailer. Manual trigger at `POST /api/backup/trigger`. **Note:** `DB_PATH` variable is referenced in `sendDatabaseBackup()` (lines 676, 677, 687) but is never declared in `server.js` — this is a latent bug.

---

*Architecture analysis: 2026-03-01*
