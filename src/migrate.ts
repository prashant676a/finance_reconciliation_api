// src/migrate.ts
import { pool } from "./db.js"; // Remember the .js extension for NodeNext ESM!
import { createTablesSql } from "./schema.js";

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
