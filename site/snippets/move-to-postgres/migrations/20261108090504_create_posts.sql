CREATE TABLE posts (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users (id),
  title TEXT NOT NULL,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX index_posts_on_user_id ON posts (user_id);
