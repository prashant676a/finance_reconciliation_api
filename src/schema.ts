// Table definitions, shared by `npm run migrate` and the test setup.
export const createTablesSql = `
  CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    order_ref VARCHAR(100) UNIQUE NOT NULL,
    customer_name VARCHAR(255) NOT NULL,
    expected_amount_paisa INTEGER NOT NULL CHECK (expected_amount_paisa > 0),
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settlements (
    id SERIAL PRIMARY KEY,
    settlement_ref VARCHAR(100) UNIQUE NOT NULL,
    order_ref VARCHAR(100) NOT NULL,
    settled_amount_paisa INTEGER NOT NULL CHECK (settled_amount_paisa >= 0),
    settled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS reconciliation_exceptions (
    id SERIAL PRIMARY KEY,
    order_ref VARCHAR(100) UNIQUE NOT NULL,
    expected_amount_paisa INTEGER NOT NULL,
    settled_amount_paisa INTEGER,
    discrepancy_paisa INTEGER NOT NULL,
    exception_type VARCHAR(50) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'OPEN',
    resolution_note TEXT,
    resolved_by VARCHAR(100),
    resolved_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`;
