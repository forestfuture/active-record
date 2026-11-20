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
CREATE TABLE photos (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL
);
CREATE TABLE videos (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL
);
CREATE TABLE likes (
  id UUID PRIMARY KEY,
  likeable_type TEXT NOT NULL,
  likeable_id UUID NOT NULL
);
CREATE INDEX index_articles_on_author_id ON articles (author_id);
CREATE INDEX index_comments_on_article_id ON comments (article_id);
