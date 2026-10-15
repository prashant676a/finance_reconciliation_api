import express from "express";
import type {Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { createOrderSchema, createSettlementSchema } from "./validators.js";
import { FinanceRepository } from "./repository.js";

export const app = express();

// 1. Middleware to parse incoming JSON request bodies into req.body
app.use(express.json())

// 2. Health check endpoint
app.get("/health", (_req, res) =>{
    res.status(200).json({status: "ok"})
})

// 3. POST /api/orders - Import a new order
app.post("/api/orders", async (req, res) => {
  const validInput = createOrderSchema.parse(req.body);
  const order = await FinanceRepository.createOrder(validInput);
  res.status(201).json({ data: order });
});

// 4. GET /api/orders - List all orders
app.get("/api/orders", async (_req, res) => {
  const orders = await FinanceRepository.getAllOrders();
  res.status(200).json({ data: orders });
});

// 5. POST /api/settlements - Import a payment settlement
app.post("/api/settlements", async (req, res) => {
  const validInput = createSettlementSchema.parse(req.body);
  const settlement = await FinanceRepository.createSettlement(validInput);
  res.status(201).json({ data: settlement });
});

// 6. Centralized Error Handler (Like Rails rescue_from!)
// Express recognizes an Error Middleware because it has EXACTLY 4 parameters: (err, req, res, next)
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  // Case A: Zod validation failed -> 400 Bad Request
  if (err instanceof ZodError) {
    res.status(400).json({
      error: "Validation failed",
      details: err.issues,
    });
    return;
  }

  // Case B: PostgreSQL UNIQUE constraint violation (code '23505') -> 409 Conflict
  if (typeof err === "object" && err !== null && "code" in err && err.code === "23505") {
    res.status(409).json({
      error: "Duplicate record: reference already exists",
    });
    return;
  }

  // Case C: Unexpected server error -> 500 Internal Server Error
  console.error("Unexpected error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// in express 5 : express auto catches error/rejected promse inside async route handler
// and forwards directly to your 4-argument error middleware