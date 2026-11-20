CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE UNIQUE INDEX index_users_on_email ON users (email);
CREATE TABLE posts (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id),
  title TEXT NOT NULL,
  published_at DATETIME
);
CREATE TABLE articles (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  view_count INTEGER NOT NULL DEFAULT 0,
  is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
  viewed_at DATETIME,
  updated_at DATETIME
);
CREATE TABLE labels (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  color TEXT
);
CREATE UNIQUE INDEX index_labels_on_name ON labels (name);
