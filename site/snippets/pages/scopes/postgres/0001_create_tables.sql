CREATE TABLE posts (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL,
  published_at TIMESTAMPTZ
);
CREATE TABLE products (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  is_available BOOLEAN NOT NULL
);
