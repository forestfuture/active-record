CREATE TABLE users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL
);
CREATE UNIQUE INDEX index_users_on_email ON users (email);
