CREATE TABLE products (
  id UUID PRIMARY KEY,
  public_id TEXT,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  archived INTEGER NOT NULL DEFAULT 0,
  metadata TEXT,
  legacy_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE billing_accounts (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL
);
CREATE VIEW product_counts AS
  SELECT status, COUNT(*)::integer AS total FROM products GROUP BY status;
