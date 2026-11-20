CREATE TABLE authors (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL
);
CREATE TABLE profiles (
  id UUID PRIMARY KEY,
  author_id UUID NOT NULL REFERENCES authors (id),
  bio TEXT
);
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
