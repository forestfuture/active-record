CREATE TABLE users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL
);
CREATE UNIQUE INDEX index_users_on_email ON users (email);
CREATE TABLE posts (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users (id),
  title TEXT NOT NULL
);
