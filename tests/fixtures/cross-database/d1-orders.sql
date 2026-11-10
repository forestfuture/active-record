-- The D1 side of tests/integration/pg/cross-database-associations.test.ts (#228): orders whose
-- customers are on Postgres.
CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  customer_id TEXT,
  total INTEGER NOT NULL
);
