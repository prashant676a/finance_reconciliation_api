import { Pool } from "pg";

export const pool = new Pool({
    connectionString: process.env.DATABASE_URL ?? "postgresql://recon:recon_dev@localhost:5432/finance_recon",
})

// default is 10 connections[reusable open connections] ( tcp-pg handshake 20-50 ms)
// ?? nullish coalescing -> fallback to local db URL