CREATE TABLE tickets (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT,
  priority INTEGER
);
CREATE TABLE conversations (
  id UUID PRIMARY KEY,
  status TEXT,
  comments TEXT
);
CREATE TABLE surveys (
  id UUID PRIMARY KEY,
  answer TEXT
);
CREATE TABLE tasks (
  id UUID PRIMARY KEY,
  state TEXT NOT NULL CHECK (state IN ('open', 'done'))
);
