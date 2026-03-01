# Codebase Structure

**Analysis Date:** 2026-03-01

## Directory Layout

```
MyDashboard/                     # Project root
├── server.js                    # Monolithic Express backend (1168 lines)
├── package.json                 # Root package: backend deps + dev scripts
├── package-lock.json
├── database.db                  # SQLite DB (dev — runtime artifact, NOT committed)
├── prisma/
│   ├── schema.prisma            # DB schema source of truth
│   └── database.db              # SQLite DB copy in prisma/ (migration artifact)
├── schemas/
│   └── zodSchemas.js            # Zod validation schemas for Gemini AI output
├── utils/
│   └── deduplication.js         # Pure JS trip deduplication logic
├── tests/
│   └── deduplication.test.js    # Jest unit tests for deduplication
├── client/                      # Vite/React frontend (separate npm project)
│   ├── package.json             # Frontend deps (React, Vite, Tailwind)
│   ├── vite.config.js           # Vite config: /api proxy to localhost:3000
│   ├── index.html               # SPA entry HTML
│   └── src/
│       ├── main.jsx             # React DOM mount
│       ├── App.jsx              # Root component: context state, layout grid
│       ├── App.css
│       ├── index.css            # Global styles, CSS custom properties
│       ├── assets/              # Static assets (images, icons)
│       ├── components/
│       │   ├── Header.jsx       # Context toggle (Personal/Professional), clock, weather
│       │   ├── ActionableInbox.jsx  # Gmail inbox panel
│       │   ├── MailCraft.jsx    # AI email composer (SSE streaming)
│       │   ├── QuickNotes.jsx   # Persistent notes widget
│       │   ├── DailyRituals.jsx # Daily habit checklist
│       │   ├── KanbanBoard.jsx  # Task management (drag-and-drop kanban)
│       │   ├── UpcomingTrips.jsx # AI-parsed trip display
│       │   ├── FocusHeatmap.jsx # Pomodoro focus heatmap
│       │   ├── Calendar.jsx     # Google Calendar events widget
│       │   ├── ZenOverlay.jsx   # Fullscreen zen/focus mode
│       │   └── AuthModal.jsx    # Google OAuth auth prompt modal
│       ├── contexts/
│       │   ├── AuthContext.jsx  # Auth modal state + requireAuth/markAuthenticated
│       │   └── WebSocketContext.jsx  # WS connection, latestEvent, isConnected
│       ├── hooks/
│       │   └── useDataFetch.js  # Universal data-fetch hook (all API calls)
│       └── utils/
│           └── api.js           # fetchWithAuth() helper, API_BASE constant
├── commands/                    # Claude slash command definitions (.toml files)
├── reference/                   # UI design reference docs (.md files)
├── MailCraft/                   # Abandoned standalone MailCraft prototype (TypeScript)
│   └── src/
│       ├── App.tsx
│       ├── api.ts
│       ├── main.tsx
│       └── index.css
├── .planning/
│   └── codebase/                # GSD mapping documents (this file)
├── .claude/                     # Claude project config
├── Handover                     # Handover document (plain text)
├── Implementation Plan          # Phase plan doc (plain text)
├── README.md
├── TECH_DIRECTOR_AUDIT.md
├── SKILL.md
├── styles.css                   # Legacy/standalone CSS (pre-React migration artifact)
├── index.html                   # Legacy standalone HTML dashboard (pre-React migration artifact, 94KB)
├── token.json                   # Google OAuth token (dev, gitignored)
├── credentials.json             # Google API credentials (dev, gitignored)
├── railway.json                 # Railway deployment config
├── railway-staging.json         # Railway staging deployment config
└── .env                         # Environment variables (gitignored)
```

## Directory Purposes

**`server.js` (root file):**
- Purpose: The entire backend. All Express routes, WebSocket server, cron jobs, Gemini AI integration, Google OAuth, Nodemailer backup.
- There is no `routes/`, `controllers/`, or `middleware/` directory — everything is inline.

**`prisma/`:**
- Purpose: Prisma ORM configuration and SQLite database
- Key files: `prisma/schema.prisma` — defines all 6 models. Do not edit the DB directly; use `npx prisma migrate dev`.
- Note: `prisma/database.db` exists alongside `database.db` in the root. The root one appears to be the active runtime DB (larger file size, more recent timestamp).

**`schemas/`:**
- Purpose: Zod schema definitions for validating external AI (Gemini) output
- Contains: `zodSchemas.js` — exports `TripsResponseSchema`, `TripSchema`, `TripComponentSchema`
- Scope: ONLY used for Trip AI pipeline validation. No request body validation schemas exist here.
- **Correction from Handover claim:** The Handover claimed `tripSchema.js` — the actual file is `zodSchemas.js`. There is no `tripSchema.js`.

**`utils/`:**
- Purpose: Pure, testable utility functions extracted from server logic
- Contains: `deduplication.js` — one exported function `deduplicateTrips()`
- Note: There is only one file here. The deduplication logic is also partially duplicated inline in `server.js` `GET /api/trips` (lines 834–865).

**`tests/`:**
- Purpose: Jest unit tests
- Contains: `deduplication.test.js` — 4 test cases for `deduplicateTrips()`
- Note: Tests are run from the root package (Jest is a root devDependency). No test coverage for routes or API integration.

**`client/`:**
- Purpose: Standalone Vite/React frontend application
- Has its own `package.json`, `node_modules`, `eslint.config.js`
- Communicates with backend exclusively via HTTP `/api/*` and WebSocket `/ws`
- Built output goes to `client/dist/` (not committed)

**`client/src/components/`:**
- Purpose: All UI widget components — one file per widget
- Each component receives `context` prop from `App.jsx` and passes it to `useDataFetch`
- No shared sub-component library; each widget is self-contained

**`client/src/contexts/`:**
- Purpose: React Context providers for cross-cutting concerns
- `AuthContext.jsx`: manages Google auth modal visibility and auth status string
- `WebSocketContext.jsx`: manages WS connection lifecycle and exposes `latestEvent`
- **Correction from Handover claim:** The Handover listed only `WebSocketContext.jsx` in `src/contexts/`. `AuthContext.jsx` also exists here.

**`client/src/hooks/`:**
- Purpose: Custom React hooks
- Contains: `useDataFetch.js` only — the universal hook for all backend data reads
- **Addition not in Handover:** `hooks/` directory and `useDataFetch.js` exist but were not mentioned in Handover claims.

**`commands/`:**
- Purpose: Claude slash command `.toml` definition files (design commands: polish, critique, animate, etc.)
- Generated: No. These are committed project configuration files.
- Not application code — tooling/AI-workflow files.

**`reference/`:**
- Purpose: UI design reference markdown documents (typography, color, motion, etc.)
- Not application code.

**`MailCraft/`:**
- Purpose: Abandoned standalone MailCraft prototype built in TypeScript
- Status: Superseded by `client/src/components/MailCraft.jsx` — this directory is dead code.

## Key File Locations

**Entry Points:**
- `server.js`: Backend entry point (line 1166: `server.listen(PORT, '0.0.0.0')`)
- `client/src/main.jsx`: Frontend SPA entry point
- `package.json` root: `"dev"` script runs both concurrently

**Configuration:**
- `prisma/schema.prisma`: Database schema — all model changes go here
- `client/vite.config.js`: Vite dev server config, `/api` proxy target
- `railway.json`: Production deployment config
- `.env` / `.env.example`: Environment variable definitions

**Core Backend Logic:**
- `server.js` lines 437–609: `syncTripsForContext()` — the AI trip pipeline
- `server.js` lines 805–881: `GET /api/trips` — serves trips + triggers background sync
- `server.js` lines 1148–1164: WebSocket server setup and `broadcastEvent()` function
- `server.js` lines 615–664: Cron job + `POST /api/webhooks/gmail`

**Core Frontend Logic:**
- `client/src/App.jsx`: Context state owner, layout grid, provider tree
- `client/src/hooks/useDataFetch.js`: All data fetching logic
- `client/src/utils/api.js`: `fetchWithAuth()` utility, `API_BASE` constant

**Validation / Utilities:**
- `schemas/zodSchemas.js`: Zod schemas for Gemini output
- `utils/deduplication.js`: Trip merging algorithm
- `tests/deduplication.test.js`: Unit tests

## Naming Conventions

**Files:**
- Backend utilities: `camelCase.js` (e.g., `deduplication.js`, `zodSchemas.js`)
- Frontend components: `PascalCase.jsx` (e.g., `UpcomingTrips.jsx`, `KanbanBoard.jsx`)
- Frontend contexts: `PascalCase.jsx` suffixed with `Context` (e.g., `AuthContext.jsx`, `WebSocketContext.jsx`)
- Frontend hooks: `camelCase.js` prefixed with `use` (e.g., `useDataFetch.js`)
- Frontend utilities: `camelCase.js` (e.g., `api.js`)
- Tests: `<moduleName>.test.js` co-located in `tests/` (not co-located with source)

**Directories:**
- Backend concerns: lowercase singular (`schemas/`, `utils/`, `tests/`, `prisma/`)
- Frontend source structure: lowercase plural (`components/`, `contexts/`, `hooks/`, `utils/`)

## Where to Add New Code

**New API endpoint:**
- Add route handler inline in `server.js` — follow the existing pattern of `app.get('/api/<resource>', async (req, res) => { ... })`
- Read `req.query.context` at the top if the resource is context-aware
- Add `contextMode` column to Prisma model if persisting a new context-aware resource

**New frontend widget/component:**
- Create `client/src/components/<ComponentName>.jsx`
- Accept `context` as a prop
- Use `useDataFetch(endpoint, context)` for data
- Import and place in the 3-column grid in `client/src/App.jsx`

**New Prisma model:**
- Add to `prisma/schema.prisma`
- Run `npx prisma migrate dev --name <migration_name>` from project root
- Include `contextMode String @default("both")` if data should be context-filterable

**New Zod validation schema:**
- Add to `schemas/zodSchemas.js` and export
- Import in `server.js` at top with other schema imports

**New utility function:**
- Add to `utils/<utilityName>.js`
- Write corresponding test in `tests/<utilityName>.test.js`

**New cron job:**
- Add `cron.schedule('<cron-expression>', async () => { ... })` in `server.js` after existing cron blocks (lines ~615–754)

## Special Directories

**`client/node_modules/`:**
- Purpose: Frontend dependencies
- Generated: Yes. Run `npm install` inside `client/`
- Committed: No

**`node_modules/` (root):**
- Purpose: Backend dependencies
- Generated: Yes. Run `npm install` in root
- Committed: No

**`client/dist/`:**
- Purpose: Vite production build output
- Generated: Yes (`npm run build`)
- Committed: No (in `client/.gitignore`)

**`.planning/codebase/`:**
- Purpose: GSD architecture mapping documents (this file and ARCHITECTURE.md)
- Generated: By GSD map-codebase agent
- Committed: Yes

**`commands/`:**
- Purpose: Claude slash command definitions
- Generated: No — manually maintained
- Committed: Yes

## Handover Claim Verification Summary

| Claim | Status | Notes |
|-------|--------|-------|
| `client/` contains Vite/React frontend | VERIFIED | `client/vite.config.js` confirmed |
| `client/src/components/UpcomingTrips.jsx` | VERIFIED | Present |
| `client/src/components/Calendar.jsx` | VERIFIED | Present |
| `client/src/contexts/WebSocketContext.jsx` | VERIFIED | Present |
| `server.js` is monolithic backend | VERIFIED | 1168 lines, all concerns inline |
| `prisma/schema.prisma` is DB source of truth | VERIFIED | 6 models present |
| Models: Trip, TripComponent, Task, Ritual, Note, Pomodoro | VERIFIED | All 6 confirmed in schema |
| Most models have `contextMode` column | VERIFIED (with exception) | `Pomodoro` has NO `contextMode` |
| `schemas/` has Zod validation schemas | PARTIALLY CORRECT | File is `zodSchemas.js`, NOT `tripSchema.js` as implied |
| `utils/` has `deduplicateTrips()` | VERIFIED | In `utils/deduplication.js` |
| Context Engine: query param → Prisma where clause | VERIFIED | Pattern confirmed in multiple routes |
| `GET /POST /api/trips` | VERIFIED | Lines 805 and 757 |
| `GET /POST /api/tasks` | VERIFIED | Lines 166 and 176 |
| `GET /api/calendar` | VERIFIED | Line 282 |
| `GET /POST /api/notes` | VERIFIED | Lines 204 and 215 |
| `POST /api/webhooks/gmail` | VERIFIED | Line 635 |
| `client/src/contexts/AuthContext.jsx` | NOT IN HANDOVER | Exists — omitted from claim |
| `client/src/hooks/useDataFetch.js` | NOT IN HANDOVER | Exists — omitted from claim |

---

*Structure analysis: 2026-03-01*
