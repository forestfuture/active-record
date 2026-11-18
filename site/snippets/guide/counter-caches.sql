-- Articles that keep a count of their comments (#61).
CREATE TABLE articles (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  comments_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT
);

CREATE TABLE comments (
  id INTEGER PRIMARY KEY,
  article_id INTEGER REFERENCES articles (id),
  body TEXT NOT NULL
);
