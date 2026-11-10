-- Both databases of tests/integration/d1/cross-database-associations.test.ts (#228). Each has every
-- table, so a read sent to the wrong one finds that database's own rows rather than failing.
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL
);

CREATE TABLE entries (
  id INTEGER PRIMARY KEY,
  user_id INTEGER,
  message TEXT NOT NULL
);

CREATE TABLE badges (
  id INTEGER PRIMARY KEY,
  user_id INTEGER,
  label TEXT NOT NULL
);

CREATE TABLE notes (
  id INTEGER PRIMARY KEY,
  entry_id INTEGER,
  body TEXT NOT NULL
);
