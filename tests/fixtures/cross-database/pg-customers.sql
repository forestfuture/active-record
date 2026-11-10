-- The Postgres side of tests/integration/pg/cross-database-associations.test.ts (#228): customers
-- whose orders are on D1, keyed by UUIDs made in code.
CREATE TABLE customers (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL
);
