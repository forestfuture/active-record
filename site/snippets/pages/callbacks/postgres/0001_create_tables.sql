CREATE TABLE orders (
  id UUID PRIMARY KEY,
  number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  email TEXT NOT NULL,
  total_cents INTEGER NOT NULL,
  is_suspended BOOLEAN NOT NULL DEFAULT FALSE,
  placed_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX index_orders_on_number ON orders (number);
CREATE TABLE users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL
);
CREATE TABLE articles (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL,
  updated_at TIMESTAMPTZ
);
CREATE TABLE invoices (
  id UUID PRIMARY KEY,
  country TEXT NOT NULL,
  currency TEXT,
  total_cents INTEGER NOT NULL DEFAULT 0
);
