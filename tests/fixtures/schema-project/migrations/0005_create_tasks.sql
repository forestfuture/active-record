CREATE TABLE tasks (
  id INTEGER PRIMARY KEY,
  title TEXT,
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'done'))
);
