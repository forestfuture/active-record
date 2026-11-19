-- Users and their profiles, which a user touches (#497).
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE profiles (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users (id),
  bio TEXT,
  updated_at TEXT
);
