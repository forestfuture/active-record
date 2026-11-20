CREATE TABLE tickets (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  status TEXT,
  priority INTEGER
);
CREATE TABLE conversations (
  id TEXT PRIMARY KEY NOT NULL,
  status TEXT,
  comments TEXT
);
CREATE TABLE surveys (
  id TEXT PRIMARY KEY NOT NULL,
  answer TEXT
);
CREATE TABLE tasks (
  id TEXT PRIMARY KEY NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('open', 'done'))
);
