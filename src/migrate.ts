// src/migrate.ts
import { pool } from "./db.js"; // Remember the .js extension for NodeNext ESM!

const createTablesSql = `
  CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    order_ref VARCHAR(100) UNIQUE NOT NULL,
    customer_name VARCHAR(255) NOT NULL,
    expected_amount_paisa INTEGER NOT NULL CHECK (expected_amount_paisa > 0),
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settlements (
    id SERIAL PRIMARY KEY,
    settlement_ref VARCHAR(100) UNIQUE NOT NULL,
    order_ref VARCHAR(100) NOT NULL,
    settled_amount_paisa INTEGER NOT NULL CHECK (settled_amount_paisa >= 0),
    settled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS reconciliation_exceptions (
    id SERIAL PRIMARY KEY,
    order_ref VARCHAR(100) UNIQUE NOT NULL,
    expected_amount_paisa INTEGER NOT NULL,
    settled_amount_paisa INTEGER,
    discrepancy_paisa INTEGER NOT NULL,
    exception_type VARCHAR(50) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'OPEN',
    resolution_note TEXT,
    resolved_by VARCHAR(100),
    resolved_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`;

async function runMigration() {
  try {
    await pool.query(createTablesSql);
    console.log("Database tables created successfully!");
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  } finally {
    await pool.end(); // Closes the connection pool so the script exits cleanly
  }
}

runMigration();

// pg bigint-> 64-bit (which exceeds js safe Number limit so pg retuns BIGINT columns as Strings)
// integer goes upto 2.14billion paisa - over 2.14 crore per single transaction -> retunrs direct as clean Number
