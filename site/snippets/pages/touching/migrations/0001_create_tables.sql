CREATE TABLE blogs (
  id TEXT PRIMARY KEY NOT NULL,
  updated_at DATETIME
);
CREATE TABLE articles (
  id TEXT PRIMARY KEY NOT NULL,
  blog_id TEXT NOT NULL REFERENCES blogs (id),
  title TEXT NOT NULL,
  updated_at DATETIME,
  last_commented_at DATETIME
);
CREATE TABLE comments (
  id TEXT PRIMARY KEY NOT NULL,
  article_id TEXT NOT NULL REFERENCES articles (id),
  body TEXT NOT NULL,
  updated_at DATETIME
);
CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  updated_at DATETIME
);
CREATE TABLE profiles (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id),
  bio TEXT,
  updated_at DATETIME
);
