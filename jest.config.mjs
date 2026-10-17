// Tests only ever use TEST_DATABASE_URL. Any DATABASE_URL from the shell is discarded so a
// development database can never be used; if TEST_DATABASE_URL is unset, src/db.ts stops the run.
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
} else {
  delete process.env.DATABASE_URL;
}

export default {
  testEnvironment: "node",
  testMatch: ["<rootDir>/.test-dist/tests/**/*.test.js"],
  transform: {},
};
