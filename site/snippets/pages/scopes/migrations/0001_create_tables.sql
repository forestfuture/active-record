CREATE TABLE posts (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  published_at DATETIME
);
CREATE TABLE products (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  is_available BOOLEAN NOT NULL
);
