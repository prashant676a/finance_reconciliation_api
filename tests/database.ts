import { pool } from "../src/db.js";

export async function resetTestDatabase() {
  const result = await pool.query<{ name: string; schema: string }>(
    "SELECT current_database() AS name, current_schema() AS schema"
  );
  if (result.rows[0]?.name !== "finance_recon_test" || result.rows[0]?.schema !== "public") {
    throw new Error("Refusing to reset tables outside finance_recon_test.public");
  }

  await pool.query(`TRUNCATE
    public.reconciliation_exceptions,
    public.settlements,
    public.orders RESTART IDENTITY`);
}
