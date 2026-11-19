-- Blogs, their articles and the articles' comments, each touching what it belongs to (#353).
CREATE TABLE blogs (
  id INTEGER PRIMARY KEY,
  updated_at TEXT
);

CREATE TABLE articles (
  id INTEGER PRIMARY KEY,
  blog_id INTEGER REFERENCES blogs (id),
  title TEXT NOT NULL,
  updated_at TEXT,
  last_commented_at TEXT
);

CREATE TABLE comments (
  id INTEGER PRIMARY KEY,
  article_id INTEGER REFERENCES articles (id),
  body TEXT NOT NULL,
  updated_at TEXT
);
