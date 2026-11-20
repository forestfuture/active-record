CREATE TABLE posts (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
