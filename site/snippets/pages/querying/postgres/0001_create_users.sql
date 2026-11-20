CREATE TABLE users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL,
  role TEXT,
  is_active BOOLEAN,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
