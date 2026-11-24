CREATE TABLE articles (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT,
  lock_version INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ
);
