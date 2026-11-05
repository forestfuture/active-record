-- An index on posts.user_id, as ../sqlite/paginated.sql adds.
CREATE INDEX posts_user_id ON posts (user_id);
