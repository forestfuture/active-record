CREATE TABLE products (
  id TEXT PRIMARY KEY NOT NULL,
  public_id TEXT,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  archived INTEGER NOT NULL DEFAULT 0,
  metadata TEXT,
  legacy_notes TEXT,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL
);
CREATE TABLE billing_accounts (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL
);
CREATE VIEW product_counts AS
  SELECT status, COUNT(*) AS total FROM products GROUP BY status;
