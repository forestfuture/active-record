CREATE TABLE articles (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  body TEXT,
  updated_at TIMESTAMPTZ
);
