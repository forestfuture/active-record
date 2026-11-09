CREATE TABLE users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX index_users_on_email ON users (email);
