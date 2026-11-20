CREATE TABLE orders (
  id TEXT PRIMARY KEY NOT NULL,
  number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  email TEXT NOT NULL,
  total_cents INTEGER NOT NULL,
  is_suspended BOOLEAN NOT NULL DEFAULT FALSE,
  placed_at DATETIME
);
CREATE UNIQUE INDEX index_orders_on_number ON orders (number);
CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL
);
CREATE TABLE articles (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  updated_at DATETIME
);
CREATE TABLE invoices (
  id TEXT PRIMARY KEY NOT NULL,
  country TEXT NOT NULL,
  currency TEXT,
  total_cents INTEGER NOT NULL DEFAULT 0
);
