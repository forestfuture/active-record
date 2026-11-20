CREATE TABLE products (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE invoices (
  id UUID PRIMARY KEY,
  total_cents INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
