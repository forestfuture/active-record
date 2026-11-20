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
  title TEXT NOT NULL,
  published BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE comments (
  id UUID PRIMARY KEY,
  article_id UUID NOT NULL REFERENCES articles (id),
  body TEXT NOT NULL
);
CREATE TABLE categories (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id UUID REFERENCES categories (id)
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
CREATE INDEX index_profiles_on_author_id ON profiles (author_id);
CREATE INDEX index_articles_on_author_id ON articles (author_id);
CREATE INDEX index_comments_on_article_id ON comments (article_id);
CREATE INDEX index_categories_on_parent_id ON categories (parent_id);
CREATE INDEX index_likes_on_likeable ON likes (likeable_type, likeable_id);
