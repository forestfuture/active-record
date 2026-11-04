-- An index on posts.user_id, so a page's tied rows come back in reverse key order unless ordered.
CREATE INDEX posts_user_id ON posts (user_id);
