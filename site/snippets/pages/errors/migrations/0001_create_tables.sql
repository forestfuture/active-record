CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL
);
CREATE UNIQUE INDEX index_users_on_email ON users (email);
