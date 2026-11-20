CREATE TABLE accounts (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL,
  handle TEXT NOT NULL,
  plan TEXT,
  seats INTEGER,
  website TEXT,
  is_company BOOLEAN,
  company_name TEXT
);
CREATE UNIQUE INDEX index_accounts_on_email ON accounts (email);
CREATE TABLE events (
  id TEXT PRIMARY KEY NOT NULL,
  starts_at DATETIME NOT NULL,
  ends_at DATETIME NOT NULL
);
CREATE TABLE invoices (
  id TEXT PRIMARY KEY NOT NULL,
  total INTEGER NOT NULL,
  currency TEXT NOT NULL
);
CREATE TABLE members (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL,
  password TEXT,
  invite_code TEXT
);
CREATE TABLE playlists (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL
);
CREATE TABLE tracks (
  id TEXT PRIMARY KEY NOT NULL,
  playlist_id TEXT NOT NULL REFERENCES playlists (id),
  title TEXT NOT NULL
);
CREATE TABLE bookings (
  id TEXT PRIMARY KEY NOT NULL,
  starts_at DATETIME NOT NULL,
  ends_at DATETIME NOT NULL
);
CREATE TABLE products (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  created_at DATETIME
);
