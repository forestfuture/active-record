CREATE TABLE articles (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  lock_version INTEGER NOT NULL DEFAULT 0,
  updated_at DATETIME
);
