-- Articles with a counter and a flag, for changing one attribute (#351).
CREATE TABLE articles (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  view_count INTEGER NOT NULL DEFAULT 0,
  is_pinned INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT
);
