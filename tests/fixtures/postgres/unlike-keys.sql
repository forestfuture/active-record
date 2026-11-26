-- Keys of types Postgres compares with no text or number (a date, a time, a timestamp and a
-- boolean), and keys of other types pointing at them (#586).
CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  held_on DATE,
  starts_at TIME,
  begins_at TIMESTAMPTZ,
  is_open BOOLEAN,
  name TEXT
);

-- A text key (code) and an integer one (number), each pointing at any of an event's keys.
CREATE TABLE tickets (
  id INTEGER PRIMARY KEY,
  code TEXT,
  number INTEGER
);
