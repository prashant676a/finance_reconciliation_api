import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import pg from "pg";

// Each run gets its own schema, so tests cannot touch the app's existing tables.
const schema = `recon_test_${randomUUID().replaceAll("-", "")}`;
const baseUrl = process.env.TEST_DATABASE_URL ??
  "postgresql://recon:recon_dev@localhost:5432/finance_recon";
const adminPool = new pg.Pool({ connectionString: baseUrl });
const testUrl = new URL(baseUrl);
testUrl.searchParams.set("options", `-csearch_path=${schema}`);

function run(args, databaseUrl) {
  const result = spawnSync(process.execPath, args, {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${args[0]} exited with ${result.status}`);
}

try {
  // The name comes from randomUUID and contains only letters, digits and underscores.
  await adminPool.query(`CREATE SCHEMA "${schema}"`);
  console.log(`Testing in isolated PostgreSQL schema: ${schema}`);
  run(["dist/migrate.js"], testUrl.toString());
  run([
    "--experimental-vm-modules",
    "node_modules/jest/bin/jest.js",
    "--runInBand",
  ], testUrl.toString());
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await adminPool.end();
}
