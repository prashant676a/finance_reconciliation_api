import { z } from "zod";

// 1. schema for creating and Order (POST /api/orders)
export const createOrderSchema = z.object({
    orderRef: z.string().trim().min(1, "orderRef is required"),
    customerName: z.string().trim().min(1, "customerName is required"),
    expectedAmountPaisa: z.number().int("Amount must be an integer in paisa").positive("expectedAmountPaisa must be greater than 0"),
})

// 2. Schema for creating a Settlement (POST /api/settlements)
export const createSettlementSchema = z.object({
  settlementRef: z.string().trim().min(1, "settlementRef is required"),
  orderRef: z.string().trim().min(1, "orderRef is required"),
  settledAmountPaisa: z
    .number()
    .int("Amount must be an integer in paisa")
    .nonnegative("settledAmountPaisa cannot be negative"),
});

// 3. Schema for resolving an Exception (PATCH /api/exceptions/:id/resolve)
export const resolveExceptionSchema = z.object({
  resolutionNote: z.string().trim().min(5, "Resolution note must be at least 5 characters"),
  resolvedBy: z.string().trim().min(1, "resolvedBy is required"),
});

// Magic TypeScript feature: Automatically generate TypeScript types from our Zod schemas!
export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type CreateSettlementInput = z.infer<typeof createSettlementSchema>;
export type ResolveExceptionInput = z.infer<typeof resolveExceptionSchema>;