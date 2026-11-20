CREATE TABLE products (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  is_available BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
