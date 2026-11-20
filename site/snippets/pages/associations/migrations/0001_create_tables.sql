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
  title TEXT NOT NULL,
  published BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE comments (
  id TEXT PRIMARY KEY NOT NULL,
  article_id TEXT NOT NULL REFERENCES articles (id),
  body TEXT NOT NULL
);
CREATE TABLE categories (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  parent_id TEXT REFERENCES categories (id)
);
CREATE TABLE photos (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL
);
CREATE TABLE videos (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL
);
CREATE TABLE likes (
  id TEXT PRIMARY KEY NOT NULL,
  likeable_type TEXT NOT NULL,
  likeable_id TEXT NOT NULL
);
CREATE INDEX index_profiles_on_author_id ON profiles (author_id);
CREATE INDEX index_articles_on_author_id ON articles (author_id);
CREATE INDEX index_comments_on_article_id ON comments (article_id);
CREATE INDEX index_categories_on_parent_id ON categories (parent_id);
CREATE INDEX index_likes_on_likeable ON likes (likeable_type, likeable_id);
