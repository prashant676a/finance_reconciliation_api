import { pool } from "./db.js";
import type {
  CreateOrderInput,
  CreateSettlementInput,
  ResolveExceptionInput,
} from "./validators.js";

export const FinanceRepository = {
  async createOrder(input: CreateOrderInput) {
    const result = await pool.query(
      `INSERT INTO orders (order_ref, customer_name, expected_amount_paisa)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [input.orderRef, input.customerName, input.expectedAmountPaisa]
    );
    return result.rows[0];
  },

  async getAllOrders() {
    const result = await pool.query(
      `SELECT * FROM orders ORDER BY created_at DESC`
    );
    return result.rows;
  },

  async createSettlement(input: CreateSettlementInput) {
    const result = await pool.query(
      `INSERT INTO settlements (settlement_ref, order_ref, settled_amount_paisa)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [input.settlementRef, input.orderRef, input.settledAmountPaisa]
    );
    return result.rows[0];
  },

  async getUnmatchedSettlements() {
    const result = await pool.query(`
      SELECT s.* FROM settlements s
      WHERE NOT EXISTS (
        SELECT 1 FROM orders o WHERE o.order_ref = s.order_ref
      )
      ORDER BY s.settled_at DESC, s.id DESC
    `);
    return result.rows;
  },

  // CORE FEATURE: Reconcile all orders against settlements inside a DB Transaction
  async runReconciliation() {
    const client = await pool.connect(); // Borrow 1 dedicated connection for the transaction
    try {
      await client.query("BEGIN");

      // Combine partial settlements so each order is processed exactly once.
      const { rows } = await client.query(`
        SELECT 
          o.order_ref,
          o.expected_amount_paisa,
          s.settled_amount_paisa
        FROM orders o
        LEFT JOIN (
          SELECT order_ref, SUM(settled_amount_paisa)::int AS settled_amount_paisa
          FROM settlements
          GROUP BY order_ref
        ) s ON o.order_ref = s.order_ref
      `);

      let matchedCount = 0;
      let discrepancyCount = 0;

      for (const row of rows) {
        const expected: number = row.expected_amount_paisa;
        const settled: number | null = row.settled_amount_paisa;

        // Case 1: Missing Settlement (LEFT JOIN returned null)
        if (settled === null) {
          discrepancyCount++;
          await client.query(
            `UPDATE orders SET status = 'DISCREPANCY' WHERE order_ref = $1`,
            [row.order_ref]
          );
          await client.query(
            `INSERT INTO reconciliation_exceptions 
              (order_ref, expected_amount_paisa, settled_amount_paisa, discrepancy_paisa, exception_type)
             VALUES ($1, $2, NULL, $3, 'MISSING_SETTLEMENT')
             ON CONFLICT (order_ref) DO UPDATE SET
              expected_amount_paisa = EXCLUDED.expected_amount_paisa,
              settled_amount_paisa = NULL,
              discrepancy_paisa = EXCLUDED.discrepancy_paisa,
              exception_type = 'MISSING_SETTLEMENT',
              status = CASE WHEN
                reconciliation_exceptions.expected_amount_paisa IS DISTINCT FROM EXCLUDED.expected_amount_paisa OR
                reconciliation_exceptions.settled_amount_paisa IS DISTINCT FROM EXCLUDED.settled_amount_paisa OR
                reconciliation_exceptions.exception_type IS DISTINCT FROM EXCLUDED.exception_type
                THEN 'OPEN' ELSE reconciliation_exceptions.status END,
              resolution_note = CASE WHEN
                reconciliation_exceptions.expected_amount_paisa IS DISTINCT FROM EXCLUDED.expected_amount_paisa OR
                reconciliation_exceptions.settled_amount_paisa IS DISTINCT FROM EXCLUDED.settled_amount_paisa OR
                reconciliation_exceptions.exception_type IS DISTINCT FROM EXCLUDED.exception_type
                THEN NULL ELSE reconciliation_exceptions.resolution_note END,
              resolved_by = CASE WHEN
                reconciliation_exceptions.expected_amount_paisa IS DISTINCT FROM EXCLUDED.expected_amount_paisa OR
                reconciliation_exceptions.settled_amount_paisa IS DISTINCT FROM EXCLUDED.settled_amount_paisa OR
                reconciliation_exceptions.exception_type IS DISTINCT FROM EXCLUDED.exception_type
                THEN NULL ELSE reconciliation_exceptions.resolved_by END,
              resolved_at = CASE WHEN
                reconciliation_exceptions.expected_amount_paisa IS DISTINCT FROM EXCLUDED.expected_amount_paisa OR
                reconciliation_exceptions.settled_amount_paisa IS DISTINCT FROM EXCLUDED.settled_amount_paisa OR
                reconciliation_exceptions.exception_type IS DISTINCT FROM EXCLUDED.exception_type
                THEN NULL ELSE reconciliation_exceptions.resolved_at END`,
            [row.order_ref, expected, expected]
          );
        }
        // Case 2: Exact Match
        else if (expected === settled) {
          matchedCount++;
          await client.query(
            `UPDATE orders SET status = 'MATCHED' WHERE order_ref = $1`,
            [row.order_ref]
          );
          await client.query(
            `UPDATE reconciliation_exceptions
             SET status = 'RESOLVED',
                 resolution_note = 'Automatically resolved after settlement matched',
                 resolved_by = 'SYSTEM',
                 resolved_at = CURRENT_TIMESTAMP
             WHERE order_ref = $1 AND status = 'OPEN'`,
            [row.order_ref]
          );
        }
        // Case 3: Amount Mismatch (e.g., expected 100000, settled 95000)
        else {
          discrepancyCount++;
          const discrepancy = expected - settled;
          await client.query(
            `UPDATE orders SET status = 'DISCREPANCY' WHERE order_ref = $1`,
            [row.order_ref]
          );
          await client.query(
            `INSERT INTO reconciliation_exceptions 
              (order_ref, expected_amount_paisa, settled_amount_paisa, discrepancy_paisa, exception_type)
             VALUES ($1, $2, $3, $4, 'AMOUNT_MISMATCH')
             ON CONFLICT (order_ref) DO UPDATE SET
              expected_amount_paisa = EXCLUDED.expected_amount_paisa,
              settled_amount_paisa = EXCLUDED.settled_amount_paisa,
              discrepancy_paisa = EXCLUDED.discrepancy_paisa,
              exception_type = 'AMOUNT_MISMATCH',
              status = CASE WHEN
                reconciliation_exceptions.expected_amount_paisa IS DISTINCT FROM EXCLUDED.expected_amount_paisa OR
                reconciliation_exceptions.settled_amount_paisa IS DISTINCT FROM EXCLUDED.settled_amount_paisa OR
                reconciliation_exceptions.exception_type IS DISTINCT FROM EXCLUDED.exception_type
                THEN 'OPEN' ELSE reconciliation_exceptions.status END,
              resolution_note = CASE WHEN
                reconciliation_exceptions.expected_amount_paisa IS DISTINCT FROM EXCLUDED.expected_amount_paisa OR
                reconciliation_exceptions.settled_amount_paisa IS DISTINCT FROM EXCLUDED.settled_amount_paisa OR
                reconciliation_exceptions.exception_type IS DISTINCT FROM EXCLUDED.exception_type
                THEN NULL ELSE reconciliation_exceptions.resolution_note END,
              resolved_by = CASE WHEN
                reconciliation_exceptions.expected_amount_paisa IS DISTINCT FROM EXCLUDED.expected_amount_paisa OR
                reconciliation_exceptions.settled_amount_paisa IS DISTINCT FROM EXCLUDED.settled_amount_paisa OR
                reconciliation_exceptions.exception_type IS DISTINCT FROM EXCLUDED.exception_type
                THEN NULL ELSE reconciliation_exceptions.resolved_by END,
              resolved_at = CASE WHEN
                reconciliation_exceptions.expected_amount_paisa IS DISTINCT FROM EXCLUDED.expected_amount_paisa OR
                reconciliation_exceptions.settled_amount_paisa IS DISTINCT FROM EXCLUDED.settled_amount_paisa OR
                reconciliation_exceptions.exception_type IS DISTINCT FROM EXCLUDED.exception_type
                THEN NULL ELSE reconciliation_exceptions.resolved_at END`,
            [row.order_ref, expected, settled, discrepancy]
          );
        }
      }

      await client.query("COMMIT");
      return {
        totalProcessed: rows.length,
        matchedCount,
        discrepancyCount,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release(); // Return the connection back to the pool!
    }
  },

  // List exceptions (with optional ?status=OPEN or ?status=RESOLVED filter)
  async getExceptions(status?: string) {
    if (status) {
      const result = await pool.query(
        `SELECT * FROM reconciliation_exceptions WHERE status = $1 ORDER BY created_at DESC`,
        [status]
      );
      return result.rows;
    }
    const result = await pool.query(
      `SELECT * FROM reconciliation_exceptions ORDER BY created_at DESC`
    );
    return result.rows;
  },

  // Resolve an exception with an audit trail
  async resolveException(id: number, input: ResolveExceptionInput) {
    const result = await pool.query(
      `UPDATE reconciliation_exceptions
       SET status = 'RESOLVED',
           resolution_note = $1,
           resolved_by = $2,
           resolved_at = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING *`,
      [input.resolutionNote, input.resolvedBy, id]
    );
    return result.rows[0]; // Returns undefined if id doesn't exist!
  },

  // Summary report for finance dashboard
  async getSummary() {
    const ordersSummary = await pool.query(`
      SELECT 
        COUNT(*)::int AS total_orders,
        COUNT(*) FILTER (WHERE status = 'MATCHED')::int AS matched_orders,
        COUNT(*) FILTER (WHERE status = 'DISCREPANCY')::int AS discrepancy_orders,
        COUNT(*) FILTER (WHERE status = 'PENDING')::int AS pending_orders
      FROM orders
    `);

    const exceptionsSummary = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'OPEN')::int AS open_exceptions,
        COUNT(*) FILTER (WHERE status = 'RESOLVED')::int AS resolved_exceptions,
        COALESCE(SUM(discrepancy_paisa) FILTER (WHERE status = 'OPEN'), 0)::int AS total_open_discrepancy_paisa
      FROM reconciliation_exceptions
    `);

    return {
      ...ordersSummary.rows[0],
      ...exceptionsSummary.rows[0],
    };
  },
};
