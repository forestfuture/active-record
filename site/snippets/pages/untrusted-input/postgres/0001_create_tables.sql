CREATE TABLE accounts (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL,
  handle TEXT NOT NULL,
  plan TEXT,
  seats INTEGER
);
CREATE TABLE invitations (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL,
  token TEXT,
  accepted_at TIMESTAMPTZ
);
