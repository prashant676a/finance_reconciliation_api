import { z } from "zod";

// PostgreSQL INTEGER is a signed 32-bit number. Validate its upper bound before SQL.
export const MAX_DB_INTEGER = 2_147_483_647;

// 1. Schema for creating an order (POST /api/orders).
export const createOrderSchema = z.object({
  orderRef: z.string().trim().min(1, "orderRef is required").max(100),
  customerName: z.string().trim().min(1, "customerName is required").max(255),
  expectedAmountPaisa: z.number()
    .int("Amount must be an integer in paisa")
    .positive("expectedAmountPaisa must be greater than 0")
    .max(MAX_DB_INTEGER, "Amount exceeds the database limit"),
});

// 2. Schema for creating a Settlement (POST /api/settlements)
export const createSettlementSchema = z.object({
  settlementRef: z.string().trim().min(1, "settlementRef is required").max(100),
  orderRef: z.string().trim().min(1, "orderRef is required").max(100),
  settledAmountPaisa: z
    .number()
    .int("Amount must be an integer in paisa")
    .nonnegative("settledAmountPaisa cannot be negative")
    .max(MAX_DB_INTEGER, "Amount exceeds the database limit"),
});

// 3. Schema for resolving an Exception (PATCH /api/exceptions/:id/resolve)
export const resolveExceptionSchema = z.object({
  resolutionNote: z.string().trim().min(5, "Resolution note must be at least 5 characters"),
  resolvedBy: z.string().trim().min(1, "resolvedBy is required").max(100),
});

export const exceptionStatusSchema = z.enum(["OPEN", "RESOLVED"]).optional();

// z.infer derives compile-time types from the runtime validation schemas.
export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type CreateSettlementInput = z.infer<typeof createSettlementSchema>;
export type ResolveExceptionInput = z.infer<typeof resolveExceptionSchema>;
