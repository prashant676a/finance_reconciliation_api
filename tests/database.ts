import { pool } from "../src/db.js";

export async function resetTestDatabase() {
  const schema = process.env.RECON_TEST_SCHEMA;
  // The runner generates this name. Direct Jest runs must never clear development tables.
  if (!schema || !/^recon_test_[a-f0-9]{32}$/.test(schema)) {
    throw new Error("Refusing to reset tables: run integration tests through npm test.");
  }

  const result = await pool.query<{ schema: string | null }>(
    "SELECT current_schema() AS schema"
  );
  if (result.rows[0]?.schema !== schema) {
    throw new Error("Refusing to reset tables: the connected schema is not the test schema.");
  }

  // Qualify every table name so even a missing test table cannot fall back to public.
  // SQL identifiers cannot be passed as $1 parameters; the name is validated above.
  await pool.query(`TRUNCATE
    "${schema}".reconciliation_exceptions,
    "${schema}".settlements,
    "${schema}".orders RESTART IDENTITY`);
}
