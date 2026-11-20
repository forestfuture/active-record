CREATE TABLE accounts (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL,
  password_digest TEXT,
  api_key TEXT,
  iban TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
