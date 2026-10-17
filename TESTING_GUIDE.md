# Testing guide

Run `npm test` from the project root. It runs Vitest, which executes the TypeScript test files directly; there is no separate build step. Before the integration tests start, they recreate the application tables in the test database. PostgreSQL must be running, the test database must already exist, and `TEST_DATABASE_URL` must be set, normally in a local `.env` copied from `.env.example` (`vitest.config.ts` reads it; CI sets the variable directly). There is no fallback: if it is unset or the database is unreachable, the run stops with an error. For validator tests without PostgreSQL, run `npm run test:unit`; for only the database-backed tests, run `npm run test:integration`.

Create the role and database once as shown under Database setup in the README. CI creates its own disposable database through the PostgreSQL service configuration.

## What a test does

A test has three parts: arrange the input, act on the code, and assert the result. For example:

```ts
const response = await request(app).get("/health");
expect(response.status).toBe(200);
expect(response.body).toEqual({ status: "ok" });
```

`request(app)` is Supertest. It sends an HTTP request to the exported Express app without starting `server.ts` yourself. Supertest manages a temporary local server and lets the operating system choose a free port. `.get("/health")` selects the method and URL. `await` waits for the response. Vitest's `expect` compares the actual result with the expected one. `toBe` compares a primitive value; `toEqual` compares an object's contents. A failed comparison makes the test fail and shows both values.

The `test("description", async () => { ... })` call registers a test. The description says what behavior the test proves. `async` lets the body use `await` for database calls and requests. Without `await`, an assertion could run before a request finishes.

## Unit tests: `tests/validators.test.ts`

These import the Zod schemas and call them directly. They do not need Express or PostgreSQL. That is why they are unit tests: one small part is checked in isolation.

`parse(input)` returns the validated, transformed value or throws a `ZodError`. We use it to prove that `.trim()` actually removes surrounding spaces. `safeParse(input)` returns an object with `success: true` or `success: false`, so invalid examples can be checked without catching an exception. `test.each([0, -1, 1.5, "100"])` runs the same amount rule with four inputs; it catches zero, negative, fractional, and string values.

The unit tests cover positive order amounts, nonnegative settlement amounts, whole paisa, required text, trimming, and the minimum resolution-note length. These are the rules that reject bad data before SQL runs.

## Integration tests: `tests/api.test.ts`

These send requests through the real Express routes into the real PostgreSQL tables. They check several parts working together: JSON parsing, Zod, the repository, SQL, transaction behavior, and HTTP error mapping. A duplicate order test, for example, proves that PostgreSQL's unique constraint becomes a `DatabaseError` with code `23505`, and that the middleware returns HTTP 409.

At the top of the file, `beforeEach` runs before every integration test. It calls `resetTestDatabase` in `tests/database.ts`. That helper runs `TRUNCATE ... RESTART IDENTITY`, which clears the three tables and resets serial IDs. Each table name is explicitly qualified with `public`. This makes each test independent of prior tests. `afterAll` closes the `pg` pool, allowing Vitest to exit cleanly. Before the first test, a `beforeAll` calls `prepareTestDatabase`, which drops the three tables and re-runs the migration, so the schema is always fresh.

The main reconciliation test creates three orders: one matched by two partial settlements, one without a settlement, and one underpaid. It checks the count returned by the run, saved order statuses, exception types and amounts, and the finance report. It runs reconciliation again and checks that there are still only two exceptions. That tests both partial-settlement aggregation and the `ON CONFLICT` behavior that avoids duplicate exception rows.

The resolution tests check the audit fields, an unchanged rerun, automatic resolution when a later settlement matches, and reopening when new settlement evidence changes a mismatch. The rollback test deliberately adds a constraint in the dedicated test database that rejects an exception insert. Reconciliation updates the order first, then the insert fails. The test checks that the order is still `PENDING`: the database rolled back the earlier update. The test removes its constraint in `finally`, which runs even if an assertion fails.

## Why tests use a separate database

`vitest.config.ts` sets `DATABASE_URL` to `TEST_DATABASE_URL` for the test run (replacing any `DATABASE_URL` from your shell), so `src/db.ts` connects to the test database and never to development data. If `TEST_DATABASE_URL` is missing, the value is empty and `src/db.ts` throws instead of using a default. The tests trust `TEST_DATABASE_URL` completely: `prepareTestDatabase` and `resetTestDatabase` in `tests/database.ts` drop and truncate tables in whatever database it names, so it must be a dedicated test database. Dropping the name check was a deliberate choice; a database-name guard would be the extra safety net if a dev URL were pasted there by mistake.

`prepareTestDatabase` runs once per test file (from `beforeAll`): it drops the three tables and recreates them with the same SQL the migration uses (`createTablesSql` in `src/schema.ts`). `resetTestDatabase` then truncates the tables before every test. Recreating the tables each run means an interrupted run or a schema change never leaves stale tables or test constraints behind. The tables are left in place after the run; the next run recreates them.

The tests use `.ts`, matching the application code. They import `test`, `expect`, `vi` and lifecycle functions from `vitest`. Vitest transforms TypeScript on the fly and resolves imports like `../src/app.js` to the matching `.ts` source, so nothing is compiled first. Type checking is a separate command, `npm run typecheck:tests`, which CI also runs, because Vitest strips types without checking them.

## Configuration explained line by line

In `tsconfig.tests.json`, `extends` reuses the project's strict settings; `rootDir: "."` lets it cover both `src/` and `tests/`; `noEmit` means it only checks types and writes no files; `include` selects application code, tests and the Vitest config.

In `vitest.config.ts`, `include` selects the test files, `fileParallelism: false` runs test files one at a time against the shared database, and `env` sets `DATABASE_URL` for the tests from `TEST_DATABASE_URL`. `loadEnv` reads `.env` plus the shell environment.

The additional boundary cases cover malformed JSON, invalid IDs and status filters, oversized fields and amounts, zero settlements, overpayments, and receipts arriving before orders. These tests follow concrete API failure cases rather than a target test count.

## Design decisions

- **Why unit and integration tests?** Unit tests pinpoint validation-rule mistakes quickly. Integration tests prove the real HTTP-to-database path, especially SQL constraints and transaction behavior that mocks cannot prove.
- **Why Supertest without manually calling `app.listen`?** The Express app is exported separately from the server entry point. Supertest manages a temporary server on an available port, avoiding a fixed development port.
- **Why a real database?** Reconciliation relies on PostgreSQL `LEFT JOIN`, `ON CONFLICT`, constraints, and transactions. Replacing SQL with a fake would miss the behavior most likely to matter in this project.
- **Why a separate database?** Tests can truncate and change constraints without touching development records. Each run recreates the tables, and `fileParallelism: false` keeps test files from interfering with each other.
- **Why test reruns?** Finance jobs are commonly retried. A retry must not create duplicate exceptions or erase a resolution when the underlying discrepancy has not changed.
- **Why test rollback?** A `BEGIN`/`ROLLBACK` claim is only meaningful if a failure after one successful write leaves no partial update behind.
- **What is still outside these tests?** One test fires several reconciliation runs at once, but there is no explicit locking and no stress test of heavy concurrency. They also do not cover amounts beyond PostgreSQL `INTEGER` limits. The current schema uses `INTEGER` for paisa, so aggregate overflow remains a design limitation.
