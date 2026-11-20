CREATE TABLE accounts (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL,
  password_digest TEXT,
  api_key TEXT,
  iban TEXT,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL
);
