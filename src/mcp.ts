import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { pool } from "./db.js";
import { createMcpServer } from "./mcpServer.js";

// Local entry point: an AI client starts this process and talks to it over stdin/stdout.
// IMPORTANT: stdout belongs to the MCP protocol. Never console.log here; use console.error.
const server = createMcpServer({ actor: "mcp-agent" });
await server.connect(new StdioServerTransport());
console.error("finance-reconciliation MCP server running on stdio");

// The client closes our stdin when it is done; release the database connections and exit.
async function shutdown() {
  await pool.end();
  process.exit(0);
}
process.stdin.on("close", shutdown);
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
