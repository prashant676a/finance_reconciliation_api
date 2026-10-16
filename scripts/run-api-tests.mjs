import { spawnSync } from "node:child_process";
import pg from "pg";

const testDatabaseUrl = process.env.TEST_DATABASE_URL ??
  "postgresql://recon:recon_dev@localhost:5432/finance_recon_test";
const client = new pg.Client({ connectionString: testDatabaseUrl });
const dropTables = `DROP TABLE IF EXISTS
  public.reconciliation_exceptions, public.settlements, public.orders CASCADE`;
const lockId = 20261016;

function run(args) {
  const result = spawnSync(process.execPath, args, {
    env: { ...process.env, DATABASE_URL: testDatabaseUrl },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${args[0]} exited with ${result.status}`);
}

let connected = false;
let locked = false;
try {
  await client.connect();
  connected = true;
  const { rows } = await client.query("SELECT current_database() AS name, current_schema() AS schema");
  if (rows[0]?.name !== "finance_recon_test" || rows[0]?.schema !== "public") {
    throw new Error("Refusing to run tests outside finance_recon_test.public");
  }

  // A second npm test waits here rather than dropping tables used by the first.
  await client.query("SELECT pg_advisory_lock($1)", [lockId]);
  locked = true;
  await client.query(dropTables);
  run([".test-dist/src/migrate.js"]);
  run(["--experimental-vm-modules", "node_modules/jest/bin/jest.js", "--runInBand"]);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (connected) {
    try {
      if (locked) {
        await client.query(dropTables);
      }
    } catch (error) {
      console.error("Test database cleanup failed:", error);
      process.exitCode = 1;
    } finally {
      // Closing this session also releases its advisory lock.
      await client.end();
    }
  }
}
