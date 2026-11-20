CREATE TABLE products (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  price NUMERIC(10, 2) NOT NULL,
  weight_kg REAL,
  stock INTEGER NOT NULL,
  in_stock BOOLEAN NOT NULL,
  launches_on DATE,
  opens_at TIME,
  details JSON,
  photo BLOB,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL
);
