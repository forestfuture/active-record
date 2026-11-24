CREATE TABLE articles (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  body TEXT,
  updated_at DATETIME
);
