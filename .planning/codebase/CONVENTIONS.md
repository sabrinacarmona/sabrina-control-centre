# Coding Conventions

**Analysis Date:** 2026-03-01

## Naming Patterns

**Files:**
- React components: PascalCase `.jsx` (e.g., `ActionableInbox.jsx`, `KanbanBoard.jsx`)
- Server modules: camelCase `.js` (e.g., `zodSchemas.js`, `deduplication.js`)
- Backend entry: flat `server.js`

**Functions/Variables:**
- camelCase for functions and variables throughout (e.g., `deduplicateTrips`, `syncTripsForContext`, `saveGroupedTripsToDb`)
- React components: PascalCase named exports (e.g., `export default function ActionableInbox`)
- Constants: SCREAMING_SNAKE_CASE for top-level config (e.g., `SCOPES`, `TOKEN_PATH`, `CREDENTIALS_PATH`, `PORT`)

**Database fields:**
- Prisma model fields: camelCase (`contextMode`, `sourceReference`, `lastResetDate`)
- API response shape: snake_case aliases added at response time (e.g., `context_mode: t.contextMode`) — this is a deliberate dual-format pattern in server responses, not inconsistency

**React props:**
- camelCase (e.g., `context`, `isZenMode`, `setIsZenMode`, `onOpenMailcraft`, `mailcraftData`)

## Code Style

**Formatting:**
- No Prettier config present at root or in client
- ESLint enforced in `client/` via `client/eslint.config.js`
- Key ESLint rules: `no-unused-vars` with `varsIgnorePattern: '^[A-Z_]'` (allows uppercase constants)
- React Hooks plugin enforced (exhaustive-deps, rules-of-hooks)
- React Refresh plugin for fast HMR

**Language:**
- Backend: CommonJS (`require`/`module.exports`) — Node.js 20.x
- Frontend: ESM (`import`/`export`) — Vite + React 19

## Import Organization

**Backend (`server.js`):**
1. Built-in Node modules (`fs`, `path`, `http`)
2. Third-party packages (`express`, `cors`, `helmet`, `googleapis`, etc.)
3. Internal modules (`./schemas/zodSchemas`, `./utils/deduplication`)
- No formal grouping enforced by linter

**Frontend components:**
1. React hooks (`import { useState, useEffect } from 'react'`)
2. Internal hooks (`import { useDataFetch } from '../hooks/useDataFetch'`)
3. Internal contexts (`import { useAuth } from '../contexts/AuthContext'`)
4. Internal utilities (`import { API_BASE } from '../utils/api'`)

**Path Aliases:**
- None configured. All imports use relative paths (`../hooks/`, `../contexts/`, `../utils/`)

## Error Handling

**Backend pattern:**
- Inline try/catch in route handlers with single-line catch blocks for simple cases:
  ```js
  } catch (e) { res.status(500).json({ error: e.message }); }
  ```
- Multi-line catch for complex async flows (e.g., trip sync, webhook processing):
  ```js
  } catch (err) {
      console.error(`[Trip Sync] Error syncing context ${context}:`, err);
      broadcastEvent('TRIP_SYNC_ERROR', { context, error: err.message });
  } finally {
      activeSyncs.delete(context);
  }
  ```
- `requiresAuth` flag appended to error JSON for auth-related 500s:
  ```js
  res.status(500).json({ error: err.message, requiresAuth: err.message.includes('authenticate') })
  ```
- Zod validation errors are NOT explicitly caught and typed — they fall into the generic catch block and propagate as `err.message`

**Frontend pattern:**
- `useDataFetch` hook centralises error handling for all data fetches
- Throws `{ requiresAuth: true }` object (not Error instance) for auth failures
- AbortError is silently ignored (clean unmount)
- Components render inline error states: `<div className="text-red-400...">Error: {error}</div>`

## Logging

**Framework:** `console` (no structured logging library)

**Patterns:**
- Prefixed bracket tags for server-side context: `[Trip Sync]`, `[Cron]`, `[Webhook]`, `[WebSocket]`
- Emoji prefixes on warnings: `⚠️` for environment warnings
- `console.error` for caught exceptions, `console.warn` for degraded-but-functional state, `console.log` for operational events

## Comments

**When to Comment:**
- Section headers with `// ---` dividers throughout `server.js` (e.g., `// --- Dependency Injection ---`, `// --- Tasks Endpoints ---`)
- Inline hotfix notes: `// --- Hotfix 4.9.2: JS-Level 14-Day Deduplication (now in utils) ---`
- Logic explanation on non-obvious branches: `// Clone to avoid mutating original payload directly before sorting`
- TODO-style comments rare; one noted: `// Optionally revert on failure, or just refetch`

**JSDoc/TSDoc:**
- Not used. No function-level documentation.

## Function Design

**Backend functions:**
- Async route handlers are inline arrow functions directly on `app.get/post/put/delete`
- Standalone async helper functions for reusable logic: `getOAuth2Client()`, `saveGroupedTripsToDb()`, `syncTripsForContext()`
- `server.js` is a single large monolithic file (1168 lines) — no route splitting into separate modules

**Frontend functions:**
- Components use named function declarations: `export default function ComponentName({ props })`
- Event handlers use camelCase `handle*` prefix: `handleAddTask`, `handleDragStart`, `handleCheckboxChange`
- Utility functions extracted to `client/src/utils/api.js` (`fetchWithAuth`)
- Custom hook in `client/src/hooks/useDataFetch.js` abstracts all API polling + WebSocket reactivity

## Module Design

**Exports:**
- Backend: `module.exports = { namedExport }` (CJS)
- Frontend: `export default function` for components; named exports for context hooks (`export const useAuth`)
- No barrel files (`index.js` re-exporters) in use

## contextMode Pattern

**Used across all Prisma models** (Task, Ritual, Note, Trip) with three values: `'personal'`, `'professional'`, `'both'`

Standard backend filter pattern:
```js
const context = req.query.context || 'both';
const items = context === 'both'
    ? await prisma.model.findMany()
    : await prisma.model.findMany({ where: { contextMode: { in: [context, 'both'] } } });
```

Frontend passes `context` prop down through component tree from `App.jsx` state. All components accept a `context` prop and forward it to `useDataFetch`.

## UI / Styling Conventions

**Framework:** Tailwind CSS v4 (via `@tailwindcss/vite` plugin), global CSS in `client/src/index.css`

**Styling approach:** Tailwind utility classes in JSX. No CSS Modules (zero `.module.css` files exist).

**Design system:**
- Primary background: `#0A0A0B` (professional), `#121212` (personal) — near-black but not pure black
- Text primary: `#F8FAFC` — near-white but not pure white
- Accent: `--color-neon-indigo: #4f46e5`
- Border: `rgba(255, 255, 255, 0.1)` — semi-transparent
- Panel utility: `.flat-panel` (transparent background + semi-transparent border) is the dominant card pattern; `glass-card` CSS class is defined but **not used** in any JSX component

**Fonts:**
- Display: `Space Grotesk` (loaded from Google Fonts, applied via `.font-display` class)
- Body: `Helvetica Neue, Arial, sans-serif` (applied to `body` by default)

**Animation easing:**
- Standard smooth: `cubic-bezier(0.4, 0, 0.2, 1)` (Material-style ease-in-out)
- Spring/overshoot for drag interactions: `cubic-bezier(0.34, 1.56, 0.64, 1)`
- Breathing animation: `8s cubic-bezier(0.4, 0, 0.2, 1) infinite`
- NOTE: These are standard easing curves, not exponential easing. The Handover claim of "exponential easing" is not reflected in the actual CSS.

**Glassmorphism status:**
- `.glass-card` is defined in `client/src/index.css` (lines 89-111) with `backdrop-filter: blur(15px)` — this is classic glassmorphism
- `.glass-card` is NOT applied in any JSX component (search confirms zero usage)
- However, `MailCraft.jsx` applies `style={{ backdropFilter: 'blur(15px)' }}` inline, and `ZenOverlay.jsx` uses `backdrop-blur-2xl` (Tailwind), so blur effects are present in practice despite the claimed "no glassmorphism" rule

---

*Convention analysis: 2026-03-01*
