CREATE TABLE blogs (
  id UUID PRIMARY KEY,
  updated_at TIMESTAMPTZ
);
CREATE TABLE articles (
  id UUID PRIMARY KEY,
  blog_id UUID NOT NULL REFERENCES blogs (id),
  title TEXT NOT NULL,
  updated_at TIMESTAMPTZ,
  last_commented_at TIMESTAMPTZ
);
CREATE TABLE comments (
  id UUID PRIMARY KEY,
  article_id UUID NOT NULL REFERENCES articles (id),
  body TEXT NOT NULL,
  updated_at TIMESTAMPTZ
);
CREATE TABLE users (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  updated_at TIMESTAMPTZ
);
CREATE TABLE profiles (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users (id),
  bio TEXT,
  updated_at TIMESTAMPTZ
);
