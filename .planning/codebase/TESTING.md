# Testing Patterns

**Analysis Date:** 2026-03-01

## Test Framework

**Runner:**
- Jest `^30.2.0` — listed in `devDependencies` of root `package.json`
- No `jest.config.js` or `jest.config.ts` file exists in the project

**HTTP Testing:**
- Supertest `^7.2.2` — listed in `devDependencies`
- NOT used in any existing test file. Supertest is installed but unused.

**Assertion Library:**
- Jest built-in (`expect`, `toBe`, `toEqual`, `toContain`)

**Run Commands:**
```bash
# There is NO working test script configured.
# Root package.json "test" script is:
# "test": "echo \"Error: no test specified\" && exit 1"
#
# To run the one existing test manually:
node --experimental-vm-modules node_modules/.bin/jest tests/deduplication.test.js
# or (after adding jest config):
npx jest
```

## Test File Organization

**Location:**
- Separate `tests/` directory at project root: `/tests/deduplication.test.js`
- NOT co-located with source files
- One additional script `test_dedup.js` at root — this is a manual debug script (queries the live database directly), NOT a Jest test

**Naming:**
- `{feature}.test.js` pattern (e.g., `deduplication.test.js`)

**Structure:**
```
MyDashboard/
├── tests/
│   └── deduplication.test.js   # Only Jest test file
├── test_dedup.js               # Manual debug script (not a test)
└── utils/
    └── deduplication.js        # Tested module
```

## Test Structure

**Suite Organization:**
```javascript
// tests/deduplication.test.js
const { deduplicateTrips } = require('../utils/deduplication');

describe('deduplicateTrips', () => {
    it('should not merge trips that are far apart', () => {
        // arrange: build input array
        // act: call deduplicateTrips(input)
        // assert: expect(result.length).toBe(2)
    });

    it('should merge trips that are within 2 days of each other and combine names', () => { ... });
    it('should ignore duplicate components when merging', () => { ... });
    it('should return empty array for empty input', () => { ... });
});
```

**Patterns:**
- Arrange-act-assert (inline, no helper functions)
- No `beforeEach` / `afterEach` / `beforeAll` / `afterAll`
- No test data factories — objects constructed inline per test case
- Pure unit tests with no I/O or side effects

## Mocking

**Framework:** None used in existing tests

**Patterns:**
- No mocks, stubs, or spies in any test file
- The tested module (`utils/deduplication.js`) is a pure function with no external dependencies, so no mocking is needed for current tests

**What to Mock (if adding server tests):**
- `prisma` PrismaClient — database calls
- `googleapis` OAuth2Client and Calendar/Gmail clients
- `@google/genai` GoogleGenAI — Gemini LLM calls
- `node-cron` — scheduled jobs

## Fixtures and Factories

**Test Data:**
- All test data is constructed inline within each `it()` block
- No shared fixtures, factories, or fixture files exist
- Example pattern:
```javascript
const input = [
    {
        TripName: "San Francisco",
        StartDate: "2024-05-01",
        EndDate: "2024-05-05",
        Components: [{ Name: "Flight to SFO" }]
    }
];
```

**Location:**
- No fixture directory exists

## Coverage

**Requirements:** None enforced — no Jest config specifying coverage thresholds

**View Coverage:**
```bash
# No coverage script configured. Would require:
npx jest --coverage
```

## Test Types

**Unit Tests:**
- One file: `tests/deduplication.test.js`
- Scope: pure function `deduplicateTrips` in `utils/deduplication.js`
- 4 test cases covering: no-merge (distant dates), merge (adjacent dates), dedup components, empty/null input

**Integration Tests:**
- None exist. Supertest is installed but has zero usage.

**E2E Tests:**
- Not used. No Playwright, Cypress, or Puppeteer in dependencies.

**API Route Tests:**
- None exist. The entire `server.js` (1168 lines, all Express routes) has no automated test coverage.

## What Is Actually Tested vs. Claimed

**Verified claims:**
- Jest is installed (devDependency) — confirmed in `package.json`
- Supertest is installed (devDependency) — confirmed in `package.json`
- Automated tests for trip deduplication logic — confirmed, `tests/deduplication.test.js` tests `deduplicateTrips()`

**Unverified / False claims:**
- Supertest is NOT used in any test. Zero HTTP route tests exist.
- The test script in `package.json` is `echo "Error: no test specified" && exit 1` — tests cannot run with `npm test`
- No Jest config file exists (`jest.config.js` / `jest.config.ts` absent)

## Common Patterns

**Async Testing:**
- Not used in current tests (deduplication is synchronous)
- Pattern to use if adding async tests:
```javascript
it('should handle async operation', async () => {
    const result = await someAsyncFunction();
    expect(result).toBeDefined();
});
```

**Error Testing:**
```javascript
// Current pattern for null/empty edge cases:
it('should return empty array for empty input', () => {
    expect(deduplicateTrips([])).toEqual([]);
    expect(deduplicateTrips(null)).toEqual([]);
});
```

## Gap Summary

The following areas have zero test coverage:

- `server.js` — all 1168 lines of Express route handlers, background sync, webhooks, WebSocket, cron jobs
- Zod schema validation in `schemas/zodSchemas.js`
- AI/LLM prompt construction and response parsing in `syncTripsForContext()`
- Gmail webhook processing (`/api/webhooks/gmail`)
- OAuth2 flow (`/api/auth/url`, `/api/auth/token`, `/oauth2callback`)
- MailCraft streaming endpoint (`/api/mailcraft/compose`)
- All Prisma database operations

---

*Testing analysis: 2026-03-01*
