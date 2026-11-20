CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL,
  role TEXT,
  is_active BOOLEAN,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL
);
