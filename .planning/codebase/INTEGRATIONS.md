# External Integrations

**Analysis Date:** 2026-03-01

## APIs & External Services

**Google Workspace (Core Integration):**
- Google Calendar API (v3) — fetch upcoming events for professional/personal context views
  - SDK/Client: `googleapis` package (`google.calendar({ version: 'v3', auth })`)
  - Auth: OAuth2 via `getOAuth2Client()` helper in `server.js`
  - Endpoints used: `calendar.events.list`, `calendar.calendarList.list`
- Gmail API (v1) — read inbox messages, send replies, watch push notifications, send backup email
  - SDK/Client: `googleapis` package (`google.gmail({ version: 'v1', auth })`)
  - Auth: same OAuth2 client
  - Endpoints used: `gmail.users.messages.list`, `gmail.users.messages.get`, `gmail.users.messages.send`, `gmail.users.watch`, `gmail.users.getProfile`
  - Scopes requested: `calendar.readonly`, `gmail.readonly`, `gmail.send`

**Google AI (Gemini):**
- Gemini 2.5 Flash — three distinct uses in `server.js`:
  1. Trip parsing: `ai.models.generateContent` — takes raw Gmail + Calendar travel data, returns structured JSON trips
  2. AI scheduling: `ai.models.generateContent` — finds optimal calendar slot for a task
  3. MailCraft: `ai.models.generateContentStream` — streams a polished email draft via SSE
  - SDK/Client: `@google/genai` v1.43.0 (`GoogleGenAI`)
  - Auth: `GEMINI_API_KEY` env var
  - Model called: `'gemini-2.5-flash'` (hardcoded string in all three call sites)

**Google Cloud Pub/Sub (Webhook Infrastructure):**
- Used indirectly: Gmail push notifications are routed via a GCP Pub/Sub topic to the `/api/webhooks/gmail` endpoint
- The `@google-cloud/pubsub` Node.js SDK is **NOT installed** — the integration works by:
  1. Calling `gmail.users.watch` with a `topicName` pointing to a pre-configured GCP Pub/Sub topic
  2. GCP Pub/Sub pushes base64-encoded notifications to `POST /api/webhooks/gmail`
  3. Server decodes and kicks off `syncTripsForContext`
- Required env vars: `GCP_PROJECT_ID`, `GCP_PUBSUB_TOPIC` (defaults to `'gmail-inbox-updates'`)
- Note: The GCP Pub/Sub topic and its subscription must be set up externally in GCP Console — no infrastructure-as-code exists in this repo

**Anthropic Claude (Unused Dependency):**
- `@anthropic-ai/sdk` v0.78.0 is listed in `package.json` dependencies
- Zero imports of this package exist anywhere in application code
- Safe to remove

## Data Storage

**Databases:**
- SQLite via Prisma ORM
  - File location: `prisma/database.db` (local) or `/data/database.db` (Railway persistent volume)
  - Connection: `DATABASE_URL` env var consumed by Prisma
  - Client: `@prisma/client` — all CRUD in `server.js` uses `prisma.*` methods
  - Schema: `prisma/schema.prisma` — 5 models: `Task`, `Ritual`, `Note`, `Pomodoro`, `Trip`, `TripComponent`
  - Migrations: Prisma migration history stored in `prisma/` (no migration files visible; likely uses `prisma db push`)

**File Storage:**
- Local filesystem only — `token.json` stored at project root (dev) or `/data/token.json` (Railway)
- No object storage (S3, GCS) detected

**Caching:**
- In-memory via `node-cache` (TTL-based):
  - Calendar data: 300 seconds (5 min) TTL, keyed by `calendarData_{context}`
  - Inbox data: 30 seconds TTL, keyed `inboxData`
  - Cache instance: `apiCache` in `server.js` line 24

## Authentication & Identity

**Auth Provider:**
- Google OAuth2 (no third-party auth library — built directly with `googleapis`)
- Flow:
  1. `GET /api/auth/url` — generates Google OAuth consent URL
  2. User authorizes → Google redirects to `GET /oauth2callback` with code
  3. `POST /api/auth/token` (or callback handler) — exchanges code for tokens
  4. Tokens stored to `token.json` or `GOOGLE_TOKEN_JSON` env var
- Frontend auth state managed by `AuthContext` (`client/src/contexts/AuthContext.jsx`) — tracks `isAuthModalOpen` and `authStatus` string; triggers `AuthModal.jsx` when API returns `requiresAuth: true`
- No session management, JWT, or cookie-based auth detected — auth is server-side token only

## Real-Time Communication

**WebSockets:**
- Server: `ws` library, attached to the HTTP server at path `/ws` (`server.js` lines 1148–1164)
- Client: Native browser `WebSocket` API via `WebSocketProvider` context (`client/src/contexts/WebSocketContext.jsx`)
- Events broadcast server → client:
  - `TRIP_SYNC_START` — when a trip sync begins
  - `TRIP_SYNC_COMPLETE` — when sync finishes successfully
  - `TRIP_SYNC_ERROR` — on sync failure
- No client → server messages implemented

**Server-Sent Events (SSE):**
- `POST /api/mailcraft` — streams Gemini AI email draft tokens to the client
- Uses `res.setHeader('Content-Type', 'text/event-stream')` pattern
- Terminates with `data: [DONE]\n\n` sentinel

## Monitoring & Observability

**Error Tracking:**
- None — no Sentry, Datadog, or similar service detected

**Logs:**
- `console.log` / `console.error` throughout `server.js`
- Structured log prefixes used: `[Trip Sync]`, `[Cron]`, `[Webhook]`, `[Backup]`, `[WebSocket]`
- No log aggregation service

## CI/CD & Deployment

**Hosting:**
- Railway.app
  - Config: `railway.json` (production — Nixpacks, `node server.js`, volume at `/data`)
  - Config: `railway-staging.json` (staging — Nixpacks with build step, `npm start`)

**CI Pipeline:**
- None detected — no GitHub Actions, CircleCI, or similar config files present

## Webhooks & Callbacks

**Incoming:**
- `POST /api/webhooks/gmail` — receives Google Cloud Pub/Sub push notifications (base64 JSON body with `message.data`) triggered by Gmail activity in the user's inbox
- Immediately responds `200 OK` to acknowledge, then fires async `syncTripsForContext`

**Outgoing:**
- None — all external calls are request-initiated (no outgoing webhook registrations in code besides the Gmail watch renewal cron)

## Scheduled Jobs (node-cron)

Three cron jobs defined in `server.js`:

| Schedule | Job | Description |
|---|---|---|
| `0 2 * * *` | Gmail Watch Renewal | Calls `gmail.users.watch` to re-subscribe Pub/Sub push notifications (daily at 2AM) |
| `0 3 * * *` | Database Backup | Emails SQLite `.db` file as attachment to the authenticated user's Gmail (daily at 3AM) |
| `0 * * * *` | Trip Sync | Calls `syncTripsForContext('professional')` then `syncTripsForContext('personal')` with a 5s sleep between (every hour) |

## Environment Configuration

**Required env vars (application will not function without these):**
- `GEMINI_API_KEY` — AI features disabled if absent (graceful degradation with console warning)
- `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` — OR `GOOGLE_CREDENTIALS_JSON`
- `DATABASE_URL` — Prisma SQLite connection string (e.g., `file:./prisma/database.db`)

**Optional env vars:**
- `GOOGLE_REDIRECT_URI` — defaults to `http://localhost:3000/oauth2callback`
- `GOOGLE_TOKEN_JSON` — paste token.json contents; used for serverless/Railway where filesystem may be ephemeral
- `GCP_PROJECT_ID` + `GCP_PUBSUB_TOPIC` — required for Gmail push webhooks to work
- `PROFESSIONAL_CALENDAR_IDS` + `PERSONAL_CALENDAR_IDS` — comma-separated; falls back to `primary` if absent
- `RAILWAY_URL` — added to CORS origin allowlist
- `RAILWAY_ENVIRONMENT` — if set, switches token path to `/data/token.json`
- `PORT` — defaults to `3000`

**Secrets location:**
- `.env` file at project root (not committed; `template.env` is the committed template)
- `token.json` at project root or `/data/token.json` — contains Google OAuth refresh token (sensitive, in `.gitignore` recommended)
- `credentials.json` at project root — Google OAuth client credentials file (present on disk, sensitive)

---

*Integration audit: 2026-03-01*
