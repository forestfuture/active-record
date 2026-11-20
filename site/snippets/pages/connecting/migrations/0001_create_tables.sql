CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL
);
CREATE UNIQUE INDEX index_users_on_email ON users (email);
CREATE TABLE posts (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id),
  title TEXT NOT NULL
);
