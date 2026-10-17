import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// Read .env (if present) plus the shell environment.
const env = loadEnv("test", process.cwd(), "");

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Integration tests share one database, so run test files one at a time.
    fileParallelism: false,
    // Tests only ever use TEST_DATABASE_URL. A DATABASE_URL from the shell is replaced, and if
    // TEST_DATABASE_URL is unset the value is empty so src/db.ts stops the run.
    env: { DATABASE_URL: env.TEST_DATABASE_URL ?? "" },
  },
});
