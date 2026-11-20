CREATE TABLE authors (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL
);
CREATE TABLE profiles (
  id TEXT PRIMARY KEY NOT NULL,
  author_id TEXT NOT NULL REFERENCES authors (id),
  bio TEXT
);
CREATE TABLE articles (
  id TEXT PRIMARY KEY NOT NULL,
  author_id TEXT NOT NULL REFERENCES authors (id),
  title TEXT NOT NULL
);
CREATE TABLE comments (
  id TEXT PRIMARY KEY NOT NULL,
  article_id TEXT NOT NULL REFERENCES articles (id),
  body TEXT NOT NULL
);
