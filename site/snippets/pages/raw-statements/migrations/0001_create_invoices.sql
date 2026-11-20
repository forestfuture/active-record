-- An integer Unix time column, as Drizzle's `integer({ mode: "timestamp" })` writes it.
CREATE TABLE invoices (
  id INTEGER PRIMARY KEY,
  total INTEGER NOT NULL,
  paid_at INTEGER
);
