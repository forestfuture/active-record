CREATE TABLE users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE UNIQUE INDEX index_users_on_email ON users (email);
CREATE TABLE posts (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users (id),
  title TEXT NOT NULL,
  published_at TIMESTAMPTZ
);
CREATE TABLE articles (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL,
  view_count INTEGER NOT NULL DEFAULT 0,
  is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
  viewed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);
CREATE TABLE labels (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT
);
CREATE UNIQUE INDEX index_labels_on_name ON labels (name);
