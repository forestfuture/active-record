-- Keys of types a link casts no other key to (a date, a time, a timestamp, a boolean, JSON and
-- bytes), a Unix time, and keys of other types pointing at them (#586).
CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  held_on DATE,
  starts_at TIME,
  begins_at TIMESTAMPTZ,
  is_open BOOLEAN,
  data JSONB,
  bytes BYTEA,
  begins_at_unix BIGINT,
  name TEXT
);

-- A text key (code), an integer one (number), a boolean one (is_open) and a date (held_on), each
-- pointing at any of an event's keys.
CREATE TABLE tickets (
  id INTEGER PRIMARY KEY,
  code TEXT,
  number INTEGER,
  is_open BOOLEAN,
  held_on DATE
);
