import { expect, test } from "@jest/globals";
import { createOrderSchema, createSettlementSchema, resolveExceptionSchema } from "../dist/validators.js";

test("order input trims text and accepts an integer number of paisa", () => {
  expect(createOrderSchema.parse({
    orderRef: "  ORD-1  ",
    customerName: "  Ada  ",
    expectedAmountPaisa: 1250,
  })).toEqual({
    orderRef: "ORD-1",
    customerName: "Ada",
    expectedAmountPaisa: 1250,
  });
});

test.each([0, -1, 1.5, "100"])("order rejects invalid amount %s", (amount) => {
  expect(createOrderSchema.safeParse({
    orderRef: "ORD-1",
    customerName: "Ada",
    expectedAmountPaisa: amount,
  }).success).toBe(false);
});

test("settlement allows zero but rejects negative and fractional paisa", () => {
  const input = { settlementRef: "SET-1", orderRef: "ORD-1" };
  expect(createSettlementSchema.safeParse({ ...input, settledAmountPaisa: 0 }).success).toBe(true);
  expect(createSettlementSchema.safeParse({ ...input, settledAmountPaisa: -1 }).success).toBe(false);
  expect(createSettlementSchema.safeParse({ ...input, settledAmountPaisa: 1.5 }).success).toBe(false);
});

test("resolution requires a meaningful note and a person", () => {
  expect(resolveExceptionSchema.safeParse({ resolutionNote: "  paid in full  ", resolvedBy: " Ada " }).data)
    .toEqual({ resolutionNote: "paid in full", resolvedBy: "Ada" });
  expect(resolveExceptionSchema.safeParse({ resolutionNote: " no ", resolvedBy: "Ada" }).success).toBe(false);
  expect(resolveExceptionSchema.safeParse({ resolutionNote: "paid in full", resolvedBy: " " }).success).toBe(false);
});
