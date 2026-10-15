# Testing guide

Run `npm test` from the project root. It compiles the application and TypeScript tests together into `.test-dist/`, creates a temporary PostgreSQL schema, applies the real migration there, runs Jest on the compiled JavaScript, and deletes that schema. PostgreSQL must be running and the configured database user must be allowed to create schemas. The runner uses the local development connection by default; set `TEST_DATABASE_URL` if your database has different credentials. For validator tests without PostgreSQL, run `npm run test:unit`.

## What a test does

A test has three parts: arrange the input, act on the code, and assert the result. For example:

```ts
const response = await request(app).get("/health");
expect(response.status).toBe(200);
expect(response.body).toEqual({ status: "ok" });
```

`request(app)` is Supertest. It sends an HTTP request to the exported Express app without starting `server.ts` yourself. Supertest manages a temporary local server and lets the operating system choose a free port. `.get("/health")` selects the method and URL. `await` waits for the response. Jest's `expect` compares the actual result with the expected one. `toBe` compares a primitive value; `toEqual` compares an object's contents. A failed comparison makes the test fail and shows both values.

The `test("description", async () => { ... })` call registers a test. The description says what behavior the test proves. `async` lets the body use `await` for database calls and requests. Without `await`, an assertion could run before a request finishes.

## Unit tests: `tests/validators.test.ts`

These import the compiled Zod schemas and call them directly. They do not need Express or PostgreSQL. That is why they are unit tests: one small part is checked in isolation.

`parse(input)` returns the validated, transformed value or throws a `ZodError`. We use it to prove that `.trim()` actually removes surrounding spaces. `safeParse(input)` returns an object with `success: true` or `success: false`, so invalid examples can be checked without catching an exception. `test.each([0, -1, 1.5, "100"])` runs the same amount rule with four inputs; it catches zero, negative, fractional, and string values.

The unit tests cover positive order amounts, nonnegative settlement amounts, whole paisa, required text, trimming, and the minimum resolution-note length. These are the rules that reject bad data before SQL runs.

## Integration tests: `tests/api.test.ts`

These send requests through the real Express routes into the real PostgreSQL tables. They check several parts working together: JSON parsing, Zod, the repository, SQL, transaction behavior, and HTTP error mapping. A duplicate order test, for example, proves that PostgreSQL's unique constraint becomes a `DatabaseError` with code `23505`, and that the middleware returns HTTP 409.

At the top of the file, `beforeEach` runs before every integration test. It calls `resetTestDatabase` in `tests/database.ts`. That helper first checks the runner-provided schema name and queries `current_schema()` to verify the connection. Only then does `TRUNCATE ... RESTART IDENTITY` clear the temporary schema's three tables and reset serial IDs. Each table name is explicitly qualified with the validated schema, preventing fallback to development tables. This makes each test independent of prior tests. `afterAll` closes the `pg` pool, allowing Jest to exit cleanly. Running the integration suite directly without the runner fails before clearing tables.

The main reconciliation test creates three orders: one matched by two partial settlements, one without a settlement, and one underpaid. It checks the count returned by the run, saved order statuses, exception types and amounts, and the finance report. It runs reconciliation again and checks that there are still only two exceptions. That tests both partial-settlement aggregation and the `ON CONFLICT` behavior that avoids duplicate exception rows.

The resolution tests check the audit fields, an unchanged rerun, automatic resolution when a later settlement matches, and reopening when new settlement evidence changes a mismatch. The rollback test deliberately adds a constraint in the temporary schema that rejects an exception insert. Reconciliation updates the order first, then the insert fails. The test checks that the order is still `PENDING`: the database rolled back the earlier update. The test removes its constraint in `finally`, which runs even if an assertion fails.

## Why the runner uses a separate schema

`scripts/run-api-tests.mjs` generates a random schema name with `randomUUID()`. It connects with an administrative pool, creates that schema, and builds a test connection URL whose PostgreSQL `search_path` points there. An unqualified query like `SELECT * FROM orders` then uses the test schema's `orders` table. The runner starts the compiled migration in a child process, then starts Jest in another child process; both receive that test URL through the `DATABASE_URL` environment variable. `spawnSync` waits for each child to finish and passes its output through to the terminal.

The `try`/`catch`/`finally` block makes cleanup reliable. A failed migration or test sets a nonzero exit status, while `finally` drops the temporary schema and closes the administrative pool. The schema name is generated internally and contains only safe identifier characters before it is placed in the `CREATE SCHEMA` and `DROP SCHEMA` statements.

The tests use `.ts`, matching the application code. They import `test`, `expect`, and lifecycle functions from `@jest/globals`, which gives TypeScript their types. `tsconfig.tests.json` includes both `src/` and `tests/`, checks their types, and compiles them together into `.test-dist/`. The main `tsconfig.json` still builds only `src/` into `dist/`. Test imports such as `../src/app.js` resolve to TypeScript source while compiling, and to the generated JavaScript when executing. No declaration files or runtime TypeScript stripping are needed for this test path. The runner passes `--experimental-vm-modules` because Jest needs it for ESM. `--runInBand` runs test files sequentially. `jest.config.mjs` finds the compiled `*.test.js` files; `transform: {}` prevents an unnecessary second compilation.

## Configuration explained line by line

In `tsconfig.tests.json`, `extends` reuses the project's strict settings; `rootDir: "."` preserves the `src/` and `tests/` directory structure; `outDir` puts generated files in `.test-dist/`; `include` selects application and test TypeScript; `exclude` avoids dependencies and generated output. In `jest.config.mjs`, `testEnvironment: "node"` selects a server environment, `testMatch` selects the generated tests, and `transform: {}` tells Jest the files are already JavaScript.

In the runner, `randomUUID` creates a unique schema suffix, `Pool` connects to PostgreSQL, and `URL.searchParams.set` adds the connection's `search_path`. `spawnSync` starts a child command and waits for it; `process.execPath` is the current Node executable; `env` passes the test connection and schema name; `stdio: "inherit"` displays child output. The child migration creates the tables. The child Jest process runs the tests. Nonzero command status becomes an error, which marks the overall command as failed. `finally` removes the temporary schema and closes the connection pool. This database lifecycle is separate from compiling TypeScript.

The additional boundary cases cover malformed JSON, invalid IDs and status filters, oversized fields and amounts, zero settlements, overpayments, and receipts arriving before orders. These tests follow concrete API failure cases rather than a target test count.

## Design decisions

- **Why unit and integration tests?** Unit tests pinpoint validation-rule mistakes quickly. Integration tests prove the real HTTP-to-database path, especially SQL constraints and transaction behavior that mocks cannot prove.
- **Why Supertest without manually calling `app.listen`?** The Express app is exported separately from the server entry point. Supertest manages a temporary server on an available port, avoiding a fixed development port.
- **Why a real database?** Reconciliation relies on PostgreSQL `LEFT JOIN`, `ON CONFLICT`, constraints, and transactions. Replacing SQL with a fake would miss the behavior most likely to matter in this project.
- **Why a temporary schema?** Tests can truncate and change constraints without touching existing finance records. It also makes repeated runs independent of old test data.
- **Why test reruns?** Finance jobs are commonly retried. A retry must not create duplicate exceptions or erase a resolution when the underlying discrepancy has not changed.
- **Why test rollback?** A `BEGIN`/`ROLLBACK` claim is only meaningful if a failure after one successful write leaves no partial update behind.
- **What is still outside these tests?** They do not simulate many reconciliation jobs running concurrently or amounts beyond PostgreSQL `INTEGER` limits. The current schema uses `INTEGER` for paisa, so aggregate overflow remains a design limitation.
