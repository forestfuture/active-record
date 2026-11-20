CREATE TABLE articles (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL,
  comments_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ
);
CREATE TABLE comments (
  id UUID PRIMARY KEY,
  article_id UUID NOT NULL REFERENCES articles (id),
  body TEXT NOT NULL
);
CREATE TABLE forums (
  id UUID PRIMARY KEY,
  reply_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE replies (
  id UUID PRIMARY KEY,
  forum_id UUID NOT NULL REFERENCES forums (id)
);
