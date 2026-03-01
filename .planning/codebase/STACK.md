# Technology Stack

**Analysis Date:** 2026-03-01

## Handover Claim Verification Summary

| Claim | Verdict | Notes |
|---|---|---|
| React 18 + Vite | INCORRECT — React is **19.2.0**, not 18 | `client/package.json` |
| Node.js 20.x | CONFIRMED | `package.json` engines field |
| Express backend in server.js | CONFIRMED, but version is **5.2.1** (not 4.x) | `package.json` |
| SQLite via Prisma ORM | CONFIRMED — Prisma is the live ORM | `server.js`, `prisma/schema.prisma` |
| Zod validation | CONFIRMED — used for AI response validation | `server.js`, `schemas/zodSchemas.js` |
| WebSockets (ws) | CONFIRMED | `server.js` line 1149 |
| Google Cloud Pub/Sub Webhooks | PARTIALLY CORRECT — uses Gmail push via Pub/Sub topic name string, but `@google-cloud/pubsub` SDK is NOT installed. Topic name is passed to Gmail API directly. | `server.js` line 627 |
| Jest + Supertest | PARTIALLY CORRECT — Jest is present as devDependency; **Supertest is installed but NOT imported in any test file**. Only one test file exists and it tests pure logic only. | `package.json`, `tests/deduplication.test.js` |
| Gemini 2.5 Flash via @google/genai | CONFIRMED — model `gemini-2.5-flash` called explicitly | `server.js` lines 580, 910, 1052 |
| @anthropic-ai/sdk present but unused | CONFIRMED — in `package.json` dependencies but zero imports anywhere in application code | `package.json` |
| node-cron for scheduled jobs | CONFIRMED | `server.js` lines 615, 730, 748 |
| nodemailer for database backup emails | CONFIRMED | `server.js` lines 695–721 |
| concurrently for dev command | CONFIRMED | `package.json` devDependencies, `scripts.dev` |
| CSS Modules with Space Grotesk | INCORRECT — **no CSS Modules** (.module.css files) are used. Styling uses **Tailwind CSS v4** with global CSS. Space Grotesk IS used as a display font but via `@import url(...)` in `client/src/index.css`. | `client/src/index.css`, `client/package.json` |

---

## Languages

**Primary:**
- JavaScript (ES2022+) — Backend (`server.js`, `utils/`, `schemas/`)
- JavaScript (JSX, ESM) — Frontend (`client/src/`)

**Secondary:**
- None detected

## Runtime

**Environment:**
- Node.js 20.x (enforced via `engines` field in `package.json`)

**Package Manager:**
- npm
- Lockfile: `package-lock.json` present (root); `client/package-lock.json` present (client)

## Frameworks

**Backend:**
- Express 5.2.1 — HTTP server, REST API, SSE streaming (`server.js`)
  - Note: Express v5 (not v4) — async error handling behavior differs

**Frontend:**
- React 19.2.0 — UI component framework (`client/src/`)
- Vite 7.3.1 — dev server and bundler (`client/vite.config.js`)
- Tailwind CSS 4.2.1 — utility-first CSS via `@tailwindcss/vite` plugin (`client/src/index.css`)

**Testing:**
- Jest 30.2.0 — test runner (devDependency, no config file; uses defaults)
- Supertest 7.2.2 — HTTP integration testing (devDependency, **not yet used in any test file**)

**Build/Dev:**
- concurrently 9.2.1 — runs server + client in parallel via `npm run dev`
- @vitejs/plugin-react 5.1.1 — React Fast Refresh for Vite

## Key Dependencies

**Critical:**
- `@prisma/client` 5.22.0 — ORM for all SQLite reads/writes; every data endpoint in `server.js` uses it
- `prisma` 5.22.0 (devDependency) — CLI for schema migrations
- `@google/genai` 1.43.0 — Gemini AI client; used for trip parsing and AI scheduling and MailCraft SSE streaming
- `googleapis` 171.4.0 — Google Calendar + Gmail API client; used for OAuth, calendar events, Gmail inbox, and backup
- `zod` 4.3.6 — Schema validation for Gemini AI JSON output (`schemas/zodSchemas.js`)
- `ws` 8.19.0 — WebSocket server; attached to the same HTTP server at path `/ws`

**Infrastructure:**
- `helmet` 8.1.0 — HTTP security headers (CSP configured explicitly in `server.js` lines 37–48)
- `cors` 2.8.6 — CORS configured for `localhost:3000` and `RAILWAY_URL` env var
- `dotenv` 17.3.1 — loads `.env` at server startup
- `node-cache` 5.1.2 — in-memory TTL cache for Google Calendar (5 min TTL) and Gmail inbox (30 sec TTL)
- `node-cron` 4.2.1 — three scheduled jobs: Gmail watch renewal (2AM), DB backup (3AM), trip sync (hourly)
- `nodemailer` 8.0.1 — sends SQLite DB file as email attachment via Gmail OAuth2 transport

**Unused / Vestigial:**
- `@anthropic-ai/sdk` 0.78.0 — listed in `dependencies`, never imported in `server.js` or any application file
- `better-sqlite3` 12.6.2 — listed in `dependencies`, only used in `test_dedup.js` (a throwaway debug script referencing an old schema with `grouped_trips` table that no longer exists). Not used in production code.

## Configuration

**Environment:**
- `.env` file (not committed; `template.env` provides the template)
- Required vars:
  - `GEMINI_API_KEY` — enables AI features
  - `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` + `GOOGLE_REDIRECT_URI` — Google OAuth
  - `GOOGLE_CREDENTIALS_JSON` — alternate: raw credentials JSON string
  - `GOOGLE_TOKEN_JSON` — alternate: raw token JSON string (for serverless/Railway)
  - `GCP_PROJECT_ID` + `GCP_PUBSUB_TOPIC` — Google Cloud Pub/Sub topic for Gmail push webhook
  - `PROFESSIONAL_CALENDAR_IDS` + `PERSONAL_CALENDAR_IDS` — comma-separated calendar IDs
  - `DATABASE_URL` — SQLite path, consumed by Prisma
  - `RAILWAY_URL` — added to CORS allowlist when running on Railway
  - `RAILWAY_ENVIRONMENT` — if set, uses `/data/token.json` path instead of local

**Build:**
- `client/vite.config.js` — Vite config; dev proxy `/api` → `http://localhost:3000`
- `client/eslint.config.js` — ESLint with react-hooks and react-refresh plugins
- `prisma/schema.prisma` — Prisma schema defining SQLite models

## Platform Requirements

**Development:**
- Node.js 20.x
- Run `npm run dev` from root to start both server (port 3000) and Vite client (default port 5173 with proxy)
- SQLite database file: `prisma/database.db` (local) or `/data/database.db` (Railway volume)

**Production:**
- Deployment target: Railway.app (Nixpacks builder, `node server.js` start command)
- Vite build output (`client/dist/`) must be served as static files — currently `server.js` uses `express.static(path.join(__dirname))` which serves from project root, **not** `client/dist/`. This may be a production configuration concern.
- Persistent volume at `/data` for SQLite database and token.json on Railway

---

*Stack analysis: 2026-03-01*
