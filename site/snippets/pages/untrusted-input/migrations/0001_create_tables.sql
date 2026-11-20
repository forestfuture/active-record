CREATE TABLE accounts (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL,
  handle TEXT NOT NULL,
  plan TEXT,
  seats INTEGER
);
CREATE TABLE invitations (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL,
  token TEXT,
  accepted_at DATETIME
);
