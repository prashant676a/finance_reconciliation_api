import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    throw new Error(
        "DATABASE_URL is not set. Set it to a PostgreSQL connection string " +
        "(for tests, set TEST_DATABASE_URL to a dedicated test database; see the README)."
    );
}

export const pool = new Pool({ connectionString });

// default is 10 connections[reusable open connections] ( tcp-pg handshake 20-50 ms)
// no fallback URL: a missing DATABASE_URL must fail loudly, never silently use a dev database
