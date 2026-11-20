CREATE TABLE authors (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL
);
CREATE UNIQUE INDEX index_authors_on_email ON authors (email);
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
