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

-- Tags on articles, through taggings (#59).
CREATE TABLE tags (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE taggings (
  id INTEGER PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES articles (id),
  tag_id INTEGER NOT NULL REFERENCES tags (id)
);

CREATE TABLE members (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL,
  password TEXT,
  invite_code TEXT
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

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL DEFAULT 0,
  available INTEGER NOT NULL DEFAULT 1,
  internal_notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE shirts (
  id INTEGER PRIMARY KEY,
  sizes TEXT NOT NULL DEFAULT ''
);

-- A like on a photo or a video, by its type and id (#60).
CREATE TABLE photos (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL
);

CREATE TABLE videos (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL
);

CREATE TABLE likes (
  id INTEGER PRIMARY KEY,
  likeable_type TEXT NOT NULL,
  likeable_id INTEGER NOT NULL
);

CREATE TABLE tags (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color TEXT
);
