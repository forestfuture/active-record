CREATE TABLE authors (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL
);
CREATE UNIQUE INDEX index_authors_on_email ON authors (email);
CREATE TABLE articles (
  id UUID PRIMARY KEY,
  author_id UUID NOT NULL REFERENCES authors (id),
  title TEXT NOT NULL
);
CREATE TABLE comments (
  id UUID PRIMARY KEY,
  article_id UUID NOT NULL REFERENCES articles (id),
  body TEXT NOT NULL
);
