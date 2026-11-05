-- ../sqlite/generated-ids.sql in Postgres's types: text keys made in code.
CREATE TABLE notebooks (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT,
  color TEXT,
  slug TEXT UNIQUE
);

CREATE TABLE notes (
  id TEXT PRIMARY KEY NOT NULL,
  notebook_id TEXT REFERENCES notebooks (id),
  body TEXT
);
