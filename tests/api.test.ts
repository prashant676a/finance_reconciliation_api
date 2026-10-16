import { afterAll, beforeEach, expect, test } from "@jest/globals";
import request from "supertest";
import { app } from "../src/app.js";
import { pool } from "../src/db.js";
import { resetTestDatabase } from "./database.js";

// Each test starts with empty tables in the dedicated test database.
beforeEach(async () => {
  await resetTestDatabase();
});

afterAll(async () => {
  await pool.end();
});

test("health and empty reports work without starting server.ts", async () => {
  const health = await request(app).get("/health");
  expect(health.status).toBe(200);
  expect(health.body).toEqual({ status: "ok" });

  const report = await request(app).get("/api/reports/summary");
  expect(report.status).toBe(200);
  expect(report.body.data).toEqual({
    total_orders: 0,
    matched_orders: 0,
    discrepancy_orders: 0,
    pending_orders: 0,
    open_exceptions: 0,
    resolved_exceptions: 0,
    total_open_discrepancy_paisa: 0,
  });
});

test("invalid order data returns 400 without inserting an order", async () => {
  const badOrder = await request(app).post("/api/orders").send({
    orderRef: "A", customerName: "Ada", expectedAmountPaisa: -5,
  });
  expect(badOrder.status).toBe(400);
  expect(badOrder.body.error).toBe("Validation failed");
  expect((await request(app).get("/api/orders")).body.data).toHaveLength(0);
});

test("duplicate order references return 409 and keep only one order", async () => {
  const order = { orderRef: "A", customerName: "Ada", expectedAmountPaisa: 100 };
  const created = await request(app).post("/api/orders").send(order);
  expect(created.status).toBe(201);
  expect(created.body.data).toMatchObject({ order_ref: "A", status: "PENDING" });
  expect((await request(app).post("/api/orders").send(order)).status).toBe(409);

  const orders = await request(app).get("/api/orders");
  expect(orders.body.data).toHaveLength(1);
});

test("settlements reject negative money and duplicate references", async () => {
  const settlement = { settlementRef: "S1", orderRef: "A", settledAmountPaisa: 100 };
  expect((await request(app).post("/api/settlements")
    .send({ ...settlement, settledAmountPaisa: -1 })).status).toBe(400);
  expect((await request(app).post("/api/settlements").send(settlement)).status).toBe(201);
  expect((await request(app).post("/api/settlements").send(settlement)).status).toBe(409);
});

test("malformed JSON returns 400 instead of 500", async () => {
  const response = await request(app).post("/api/orders")
    .set("Content-Type", "application/json").send("{");
  expect(response.status).toBe(400);
  expect(response.body).toEqual({ error: "Invalid JSON body" });
});

test.each(["abc", "1.5", "0", "-1", "2147483648", "Infinity"])(
  "invalid exception ID %s returns 400",
  async (id) => {
    const response = await request(app).patch(`/api/exceptions/${id}/resolve`).send({
      resolutionNote: "Checked ledger", resolvedBy: "Ada",
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid exception ID");
  }
);

test("unknown or repeated status filters return 400", async () => {
  expect((await request(app).get("/api/exceptions?status=UNKNOWN")).status).toBe(400);
  expect((await request(app).get("/api/exceptions?status=OPEN&status=RESOLVED")).status).toBe(400);
});

test("an amount larger than the database limit returns 400", async () => {
  const response = await request(app).post("/api/orders").send({
    orderRef: "OVERFLOW", customerName: "Ada", expectedAmountPaisa: 2_147_483_648,
  });
  expect(response.status).toBe(400);
  expect((await request(app).get("/api/orders")).body.data).toHaveLength(0);
});

test.each([0, 150])("a settlement of %i against 100 paisa is an amount mismatch", async (amount) => {
  expect((await request(app).post("/api/orders").send({
    orderRef: "AMOUNT", customerName: "Ada", expectedAmountPaisa: 100,
  })).status).toBe(201);
  expect((await request(app).post("/api/settlements").send({
    settlementRef: "AMOUNT-S", orderRef: "AMOUNT", settledAmountPaisa: amount,
  })).status).toBe(201);
  expect((await request(app).post("/api/reconciliations/run")).status).toBe(200);
  const exceptions = (await request(app).get("/api/exceptions")).body.data;
  expect(exceptions).toHaveLength(1);
  expect(exceptions[0]).toMatchObject({
    exception_type: "AMOUNT_MISMATCH", settled_amount_paisa: amount, discrepancy_paisa: 100 - amount,
  });
});

test("an unmatched settlement stays visible until its order arrives", async () => {
  expect((await request(app).post("/api/settlements").send({
    settlementRef: "EARLY-S", orderRef: "LATE-ORDER", settledAmountPaisa: 100,
  })).status).toBe(201);
  const unmatched = await request(app).get("/api/settlements/unmatched");
  expect(unmatched.status).toBe(200);
  expect(unmatched.body.data).toHaveLength(1);
  expect(unmatched.body.data[0].settlement_ref).toBe("EARLY-S");
  expect((await request(app).post("/api/reconciliations/run")).body.data.totalProcessed).toBe(0);

  expect((await request(app).post("/api/orders").send({
    orderRef: "LATE-ORDER", customerName: "Ada", expectedAmountPaisa: 100,
  })).status).toBe(201);
  expect((await request(app).get("/api/settlements/unmatched")).body.data).toHaveLength(0);
  expect((await request(app).post("/api/reconciliations/run")).body.data.matchedCount).toBe(1);
});

test("reconciliation totals partial settlements and is safe to rerun", async () => {
  for (const [orderRef, expectedAmountPaisa] of [["MATCH", 100], ["MISSING", 80], ["SHORT", 100]]) {
    expect((await request(app).post("/api/orders").send({
      orderRef, customerName: "Ada", expectedAmountPaisa,
    })).status).toBe(201);
  }
  for (const [settlementRef, orderRef, settledAmountPaisa] of [
    ["S1", "MATCH", 40], ["S2", "MATCH", 60], ["S3", "SHORT", 70],
  ]) {
    expect((await request(app).post("/api/settlements").send({
      settlementRef, orderRef, settledAmountPaisa,
    })).status).toBe(201);
  }

  const firstRun = await request(app).post("/api/reconciliations/run");
  expect(firstRun.status).toBe(200);
  expect(firstRun.body.data).toEqual({ totalProcessed: 3, matchedCount: 1, discrepancyCount: 2 });

  const orders = (await request(app).get("/api/orders")).body.data;
  expect(Object.fromEntries(orders.map(({ order_ref, status }: { order_ref: string; status: string }) => [order_ref, status])))
    .toEqual({ MATCH: "MATCHED", MISSING: "DISCREPANCY", SHORT: "DISCREPANCY" });

  const exceptions = (await request(app).get("/api/exceptions?status=OPEN")).body.data;
  expect(exceptions).toHaveLength(2);
  expect(exceptions.find((row: { order_ref: string }) => row.order_ref === "MISSING"))
    .toMatchObject({ exception_type: "MISSING_SETTLEMENT", settled_amount_paisa: null, discrepancy_paisa: 80 });
  expect(exceptions.find((row: { order_ref: string }) => row.order_ref === "SHORT"))
    .toMatchObject({ exception_type: "AMOUNT_MISMATCH", settled_amount_paisa: 70, discrepancy_paisa: 30 });

  const report = await request(app).get("/api/reports/summary");
  expect(report.body.data).toMatchObject({
    total_orders: 3, matched_orders: 1, discrepancy_orders: 2,
    open_exceptions: 2, total_open_discrepancy_paisa: 110,
  });

  expect((await request(app).post("/api/reconciliations/run")).body.data)
    .toEqual(firstRun.body.data);
  expect((await request(app).get("/api/exceptions")).body.data).toHaveLength(2);
});

test("manual resolution keeps its audit fields when unchanged discrepancy is rerun", async () => {
  await request(app).post("/api/orders").send({
    orderRef: "MANUAL", customerName: "Ada", expectedAmountPaisa: 100,
  });
  await request(app).post("/api/reconciliations/run");
  const exception = (await request(app).get("/api/exceptions")).body.data[0];

  expect((await request(app).patch("/api/exceptions/abc/resolve").send({
    resolutionNote: "Checked ledger", resolvedBy: "Ada",
  })).status).toBe(400);
  expect((await request(app).patch("/api/exceptions/999/resolve").send({
    resolutionNote: "Checked ledger", resolvedBy: "Ada",
  })).status).toBe(404);
  expect((await request(app).patch(`/api/exceptions/${exception.id}/resolve`).send({
    resolutionNote: "bad", resolvedBy: "Ada",
  })).status).toBe(400);

  const resolved = await request(app).patch(`/api/exceptions/${exception.id}/resolve`).send({
    resolutionNote: "Checked ledger", resolvedBy: "Ada",
  });
  expect(resolved.status).toBe(200);
  expect(resolved.body.data).toMatchObject({
    status: "RESOLVED", resolution_note: "Checked ledger", resolved_by: "Ada",
  });
  expect(resolved.body.data.resolved_at).toBeTruthy();

  await request(app).post("/api/reconciliations/run");
  const afterRerun = (await request(app).get("/api/exceptions?status=RESOLVED")).body.data[0];
  expect(afterRerun).toMatchObject({
    id: exception.id, resolution_note: "Checked ledger", resolved_by: "Ada",
  });
});

test("a later matching settlement automatically closes an open exception", async () => {
  await request(app).post("/api/orders").send({
    orderRef: "LATER", customerName: "Ada", expectedAmountPaisa: 100,
  });
  await request(app).post("/api/reconciliations/run");
  await request(app).post("/api/settlements").send({
    settlementRef: "LATER-S", orderRef: "LATER", settledAmountPaisa: 100,
  });
  expect((await request(app).post("/api/reconciliations/run")).body.data.matchedCount).toBe(1);
  expect((await request(app).get("/api/exceptions?status=OPEN")).body.data).toHaveLength(0);
  expect((await request(app).get("/api/exceptions?status=RESOLVED")).body.data[0])
    .toMatchObject({ order_ref: "LATER", resolved_by: "SYSTEM" });
});

test("new settlement evidence reopens a previously resolved mismatch", async () => {
  await request(app).post("/api/orders").send({
    orderRef: "CHANGED", customerName: "Ada", expectedAmountPaisa: 100,
  });
  await request(app).post("/api/settlements").send({
    settlementRef: "CHANGED-S1", orderRef: "CHANGED", settledAmountPaisa: 60,
  });
  await request(app).post("/api/reconciliations/run");
  const original = (await request(app).get("/api/exceptions")).body.data[0];
  await request(app).patch(`/api/exceptions/${original.id}/resolve`).send({
    resolutionNote: "Investigated difference", resolvedBy: "Ada",
  });

  await request(app).post("/api/settlements").send({
    settlementRef: "CHANGED-S2", orderRef: "CHANGED", settledAmountPaisa: 10,
  });
  await request(app).post("/api/reconciliations/run");

  const reopened = (await request(app).get("/api/exceptions?status=OPEN")).body.data[0];
  expect(reopened).toMatchObject({
    id: original.id, settled_amount_paisa: 70, discrepancy_paisa: 30,
    status: "OPEN", resolution_note: null, resolved_by: null, resolved_at: null,
  });
});

test("a database failure rolls back the order status change", async () => {
  await request(app).post("/api/orders").send({
    orderRef: "ROLLBACK", customerName: "Ada", expectedAmountPaisa: 100,
  });
  // Force exception insertion to fail after reconciliation has updated the order.
  await pool.query("ALTER TABLE reconciliation_exceptions ADD CONSTRAINT reject_missing CHECK (exception_type <> 'MISSING_SETTLEMENT')");
  try {
    const response = await request(app).post("/api/reconciliations/run");
    expect(response.status).toBe(500);
    expect((await request(app).get("/api/orders")).body.data[0].status).toBe("PENDING");
    expect((await request(app).get("/api/exceptions")).body.data).toHaveLength(0);
  } finally {
    await pool.query("ALTER TABLE reconciliation_exceptions DROP CONSTRAINT reject_missing");
  }
});
