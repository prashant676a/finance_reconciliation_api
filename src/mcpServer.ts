import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FinanceRepository } from "./repository.js";
import { exceptionStatusSchema, resolveExceptionSchema, MAX_DB_INTEGER } from "./validators.js";

// Lists are capped so one tool call cannot flood the model's context window.
const MAX_ROWS = 50;

// MCP tool results are a list of content blocks. We always return one block of JSON text.
function jsonResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function errorResult(message: string) {
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}

// Run a tool body; never leak database error details to the model, log them to stderr instead.
// (stdout is reserved for MCP protocol messages when the server runs over stdio.)
async function guarded(run: () => Promise<ReturnType<typeof jsonResult>>) {
  try {
    return await run();
  } catch (error) {
    console.error("MCP tool failed:", error);
    return errorResult("The operation failed. Check the server logs.");
  }
}

function capped<T>(rows: T[]) {
  return { total: rows.length, returned: Math.min(rows.length, MAX_ROWS), rows: rows.slice(0, MAX_ROWS) };
}

// `actor` is who the server records as `resolved_by`. It comes from the server's own
// configuration, never from tool arguments, so the model cannot choose its own identity.
export function createMcpServer(options: { actor: string }) {
  const server = new McpServer({ name: "finance-reconciliation", version: "1.0.0" });

  server.registerTool(
    "get_summary",
    {
      title: "Reconciliation summary",
      description:
        "Counts of orders by status, open and resolved exceptions, and the total open discrepancy in paisa (1 rupee = 100 paisa).",
      annotations: { readOnlyHint: true },
    },
    () => guarded(async () => jsonResult(await FinanceRepository.getSummary()))
  );

  server.registerTool(
    "list_exceptions",
    {
      title: "List reconciliation exceptions",
      description:
        `Orders whose settlements are missing or do not add up. Optionally filter by status. Returns at most ${MAX_ROWS} rows, newest first.`,
      inputSchema: { status: exceptionStatusSchema },
      annotations: { readOnlyHint: true },
    },
    ({ status }) => guarded(async () => jsonResult(capped(await FinanceRepository.getExceptions(status))))
  );

  server.registerTool(
    "list_unmatched_settlements",
    {
      title: "List unmatched settlements",
      description:
        `Settlement receipts whose order reference does not exist yet. Returns at most ${MAX_ROWS} rows.`,
      annotations: { readOnlyHint: true },
    },
    () => guarded(async () => jsonResult(capped(await FinanceRepository.getUnmatchedSettlements())))
  );

  server.registerTool(
    "run_reconciliation",
    {
      title: "Run reconciliation",
      description:
        "Compare every order with the sum of its settlements and update order statuses and exceptions. Safe to repeat: unchanged results are not modified.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    () => guarded(async () => jsonResult(await FinanceRepository.runReconciliation()))
  );

  server.registerTool(
    "resolve_exception",
    {
      title: "Resolve an exception",
      description:
        "Mark one exception as resolved with a written note (at least 5 characters). Overwrites any earlier resolution note on that exception.",
      inputSchema: {
        exceptionId: z.number().int().positive().max(MAX_DB_INTEGER),
        resolutionNote: resolveExceptionSchema.shape.resolutionNote,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    ({ exceptionId, resolutionNote }) =>
      guarded(async () => {
        const updated = await FinanceRepository.resolveException(exceptionId, {
          resolutionNote,
          resolvedBy: options.actor,
        });
        return updated ? jsonResult(updated) : errorResult(`Exception ${exceptionId} was not found.`);
      })
  );

  return server;
}
