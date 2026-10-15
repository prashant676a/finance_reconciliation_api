import { expect, test } from "@jest/globals";
import { createOrderSchema, createSettlementSchema, resolveExceptionSchema, MAX_DB_INTEGER } from "../src/validators.js";

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

test("money validation accepts the database boundary and rejects overflow", () => {
  const order = { orderRef: "LIMIT", customerName: "Ada", expectedAmountPaisa: MAX_DB_INTEGER };
  expect(createOrderSchema.safeParse(order).success).toBe(true);
  expect(createOrderSchema.safeParse({ ...order, expectedAmountPaisa: MAX_DB_INTEGER + 1 }).success).toBe(false);

  const settlement = { settlementRef: "LIMIT-S", orderRef: "LIMIT", settledAmountPaisa: MAX_DB_INTEGER };
  expect(createSettlementSchema.safeParse(settlement).success).toBe(true);
  expect(createSettlementSchema.safeParse({ ...settlement, settledAmountPaisa: MAX_DB_INTEGER + 1 }).success).toBe(false);
});

test.each([
  { orderRef: " " },
  { orderRef: "x".repeat(101) },
  { customerName: " " },
  { customerName: "x".repeat(256) },
])("order rejects missing or oversized text: %j", (invalidField) => {
  expect(createOrderSchema.safeParse({
    orderRef: "A", customerName: "Ada", expectedAmountPaisa: 100, ...invalidField,
  }).success).toBe(false);
});

test("settlement and resolution text respect database lengths", () => {
  const settlement = { settlementRef: "S", orderRef: "A", settledAmountPaisa: 0 };
  expect(createSettlementSchema.safeParse({ ...settlement, settlementRef: "x".repeat(101) }).success).toBe(false);
  expect(createSettlementSchema.safeParse({ ...settlement, orderRef: "x".repeat(101) }).success).toBe(false);
  expect(resolveExceptionSchema.safeParse({ resolutionNote: "Checked ledger", resolvedBy: "x".repeat(101) }).success).toBe(false);
});
