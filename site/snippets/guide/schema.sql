-- The tables the guide's examples use (tests/integration/d1/site-examples.test.ts).
CREATE TABLE authors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE articles (
  id TEXT PRIMARY KEY,
  author_id TEXT NOT NULL REFERENCES authors (id),
  title TEXT NOT NULL,
  published INTEGER NOT NULL DEFAULT 0,
  created_at TEXT
);

CREATE TABLE profiles (
  id INTEGER PRIMARY KEY,
  author_id TEXT NOT NULL REFERENCES authors (id),
  bio TEXT
);

CREATE TABLE comments (
  id INTEGER PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES articles (id),
  body TEXT NOT NULL
);

CREATE TABLE accounts (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL,
  handle TEXT NOT NULL,
  plan TEXT,
  seats INTEGER,
  website TEXT,
  is_company INTEGER,
  company_name TEXT
);

CREATE TABLE bookings (
  id INTEGER PRIMARY KEY,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL
);

CREATE TABLE invitations (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL,
  token TEXT, -- NULL once the invitation is accepted
  accepted_at TEXT
);
