CREATE TABLE products (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  price NUMERIC(10, 2) NOT NULL,
  weight_kg DOUBLE PRECISION,
  stock INTEGER NOT NULL,
  in_stock BOOLEAN NOT NULL,
  launches_on DATE,
  opens_at TIME,
  details JSONB,
  photo BYTEA,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
