import express from "express";
import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import {
  createOrderSchema,
  createSettlementSchema,
  resolveExceptionSchema,
} from "./validators.js";
import { FinanceRepository } from "./repository.js";

export const app = express();

app.use(express.json());

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

// 1. POST /api/orders
app.post("/api/orders", async (req, res) => {
  const validInput = createOrderSchema.parse(req.body);
  const order = await FinanceRepository.createOrder(validInput);
  res.status(201).json({ data: order });
});

// 2. GET /api/orders
app.get("/api/orders", async (_req, res) => {
  const orders = await FinanceRepository.getAllOrders();
  res.status(200).json({ data: orders });
});

// 3. POST /api/settlements
app.post("/api/settlements", async (req, res) => {
  const validInput = createSettlementSchema.parse(req.body);
  const settlement = await FinanceRepository.createSettlement(validInput);
  res.status(201).json({ data: settlement });
});

// 4. POST /api/reconciliations/run
app.post("/api/reconciliations/run", async (_req, res) => {
  const summary = await FinanceRepository.runReconciliation();
  res.status(200).json({ data: summary });
});

// 5. GET /api/exceptions (Supports optional ?status=OPEN query param)
app.get("/api/exceptions", async (req, res) => {
  const statusFilter =
    typeof req.query.status === "string" ? req.query.status : undefined;
  const exceptions = await FinanceRepository.getExceptions(statusFilter);
  res.status(200).json({ data: exceptions });
});

// 6. PATCH /api/exceptions/:id/resolve
app.patch("/api/exceptions/:id/resolve", async (req, res) => {
  const exceptionId = Number(req.params.id);
  if (Number.isNaN(exceptionId)) {
    res.status(400).json({ error: "Invalid exception ID" });
    return;
  }

  const validInput = resolveExceptionSchema.parse(req.body);
  const updated = await FinanceRepository.resolveException(
    exceptionId,
    validInput
  );

  if (!updated) {
    res.status(404).json({ error: "Exception not found" });
    return;
  }

  res.status(200).json({ data: updated });
});

// 7. GET /api/reports/summary
app.get("/api/reports/summary", async (_req, res) => {
  const report = await FinanceRepository.getSummary();
  res.status(200).json({ data: report });
});

// Centralized Error Handler
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: "Validation failed",
      details: err.issues,
    });
    return;
  }

  if (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    err.code === "23505"
  ) {
    res.status(409).json({
      error: "Duplicate record: reference already exists",
    });
    return;
  }

  console.error("Unexpected error:", err);
  res.status(500).json({ error: "Internal server error" });
});