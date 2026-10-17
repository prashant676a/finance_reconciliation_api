import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { pool } from "../src/db.js";
import { FinanceRepository } from "../src/repository.js";
import { createMcpServer } from "../src/mcpServer.js";
import { prepareTestDatabase, resetTestDatabase } from "./database.js";

// The MCP server and a real MCP client are connected in memory (no process, no stdio),
// but the tools run against the real test database.
let client: Client;

beforeAll(async () => {
  await prepareTestDatabase();
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer({ actor: "test-agent" }).connect(serverSide);
  client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(clientSide);
});

beforeEach(async () => {
  await resetTestDatabase();
});

afterAll(async () => {
  await client.close();
  await pool.end();
});

type ToolResult = { isError?: boolean; content: { type: string; text: string }[] };

// Call a tool and return the isError flag plus the text of its single content block.
async function callTool(name: string, args: Record<string, unknown> = {}) {
  const result = (await client.callTool({ name, arguments: args })) as ToolResult;
  return { isError: result.isError === true, text: result.content[0]?.text ?? "" };
}

async function seedMismatch() {
  await FinanceRepository.createOrder({ orderRef: "SHORT", customerName: "Ada", expectedAmountPaisa: 100 });
  await FinanceRepository.createOrder({ orderRef: "MISSING", customerName: "Ada", expectedAmountPaisa: 80 });
  await FinanceRepository.createSettlement({ settlementRef: "S1", orderRef: "SHORT", settledAmountPaisa: 70 });
}

test("the server advertises five tools and marks the read-only ones", async () => {
  const { tools } = await client.listTools();
  expect(tools.map((tool) => tool.name).sort()).toEqual([
    "get_summary", "list_exceptions", "list_unmatched_settlements", "resolve_exception", "run_reconciliation",
  ]);
  const readOnly = tools.filter((tool) => tool.annotations?.readOnlyHint).map((tool) => tool.name).sort();
  expect(readOnly).toEqual(["get_summary", "list_exceptions", "list_unmatched_settlements"]);
});

test("get_summary reports an empty database", async () => {
  const { isError, text } = await callTool("get_summary");
  expect(isError).toBe(false);
  expect(JSON.parse(text)).toMatchObject({ total_orders: 0, open_exceptions: 0 });
});

test("run_reconciliation then list_exceptions shows the discrepancies", async () => {
  await seedMismatch();
  const run = await callTool("run_reconciliation");
  expect(JSON.parse(run.text)).toEqual({ totalProcessed: 2, matchedCount: 0, discrepancyCount: 2 });

  const open = JSON.parse((await callTool("list_exceptions", { status: "OPEN" })).text);
  expect(open.total).toBe(2);
  expect(open.rows.map((row: { order_ref: string }) => row.order_ref).sort()).toEqual(["MISSING", "SHORT"]);
});

test("resolve_exception records the server's actor, not a name supplied by the model", async () => {
  await seedMismatch();
  await callTool("run_reconciliation");
  const [first] = JSON.parse((await callTool("list_exceptions", { status: "OPEN" })).text).rows;

  // "resolvedBy" is not part of the tool's input schema, so the extra argument is ignored.
  const resolved = await callTool("resolve_exception", {
    exceptionId: first.id, resolutionNote: "Checked the ledger", resolvedBy: "someone-else",
  });
  expect(resolved.isError).toBe(false);
  expect(JSON.parse(resolved.text)).toMatchObject({ status: "RESOLVED", resolved_by: "test-agent" });
});

test("unknown exception IDs and invalid input come back as tool errors", async () => {
  const missing = await callTool("resolve_exception", { exceptionId: 999, resolutionNote: "Checked the ledger" });
  expect(missing).toEqual({ isError: true, text: "Exception 999 was not found." });

  const shortNote = await callTool("resolve_exception", { exceptionId: 1, resolutionNote: "x" });
  expect(shortNote.isError).toBe(true);
  expect(shortNote.text).toContain("Invalid arguments for tool resolve_exception");

  const badStatus = await callTool("list_exceptions", { status: "DELETED" });
  expect(badStatus.isError).toBe(true);
});

test("list results are capped at 50 rows but report the real total", async () => {
  for (let i = 1; i <= 55; i++) {
    await FinanceRepository.createSettlement({ settlementRef: `S-${i}`, orderRef: `NO-ORDER-${i}`, settledAmountPaisa: 10 });
  }
  const result = JSON.parse((await callTool("list_unmatched_settlements")).text);
  expect(result).toMatchObject({ total: 55, returned: 50 });
  expect(result.rows).toHaveLength(50);
});
