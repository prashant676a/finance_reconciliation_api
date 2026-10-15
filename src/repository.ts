import { pool } from "./db.js";
import type { CreateOrderInput, CreateSettlementInput } from "./validators.js";

export const FinanceRepository = {
  // Equivalent to Rails: Order.create!(input)
  async createOrder(input: CreateOrderInput) {
    const result = await pool.query(
      `INSERT INTO orders (order_ref, customer_name, expected_amount_paisa)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [input.orderRef, input.customerName, input.expectedAmountPaisa]
    );
    return result.rows[0];
  },

  // Equivalent to Rails: Order.order(created_at: :desc).all
  async getAllOrders() {
    const result = await pool.query(
      `SELECT * FROM orders ORDER BY created_at DESC`
    );
    return result.rows;
  },

  // Equivalent to Rails: Settlement.create!(input)
  async createSettlement(input: CreateSettlementInput) {
    const result = await pool.query(
      `INSERT INTO settlements (settlement_ref, order_ref, settled_amount_paisa)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [input.settlementRef, input.orderRef, input.settledAmountPaisa]
    );
    return result.rows[0];
  },
};
