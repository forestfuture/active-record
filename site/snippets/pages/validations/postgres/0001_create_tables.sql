CREATE TABLE accounts (
  id UUID PRIMARY KEY,
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
  id UUID PRIMARY KEY,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE invoices (
  id UUID PRIMARY KEY,
  total INTEGER NOT NULL,
  currency TEXT NOT NULL
);
CREATE TABLE members (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL,
  password TEXT,
  invite_code TEXT
);
CREATE TABLE playlists (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL
);
CREATE TABLE tracks (
  id UUID PRIMARY KEY,
  playlist_id UUID NOT NULL REFERENCES playlists (id),
  title TEXT NOT NULL
);
CREATE TABLE bookings (
  id UUID PRIMARY KEY,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE products (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  created_at TIMESTAMPTZ
);
