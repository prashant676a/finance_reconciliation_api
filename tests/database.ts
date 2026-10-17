import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { pool } from "../src/db.js";

// Once per test file: start from a fresh schema by dropping and re-running the migration.
// TEST_DATABASE_URL is trusted as the dedicated test database.
export async function prepareTestDatabase() {
  try {
    await pool.query("SELECT 1");
  } catch (error) {
    throw new Error(
      "Cannot connect to the test database. Make sure PostgreSQL is running, the database in " +
        "TEST_DATABASE_URL exists (see 'Database setup' in the README), and the credentials are correct.",
      { cause: error }
    );
  }
  await pool.query(`DROP TABLE IF EXISTS
    public.reconciliation_exceptions, public.settlements, public.orders CASCADE`);
  execFileSync(process.execPath, [fileURLToPath(new URL("../src/migrate.js", import.meta.url))], {
    stdio: ["ignore", "ignore", "inherit"],
  });
}

// Before every test: empty tables.
export async function resetTestDatabase() {
  await pool.query(`TRUNCATE
    public.reconciliation_exceptions,
    public.settlements,
    public.orders RESTART IDENTITY`);
}
