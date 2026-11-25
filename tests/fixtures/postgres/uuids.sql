-- ../sqlite/uuids.sql with UUID columns, which refuse text that isn't a UUID.
CREATE TABLE devices (
  id UUID PRIMARY KEY,
  name TEXT
);

-- A text foreign key (device_id) and an integer one (level), each pointing at a UUID key (#563).
CREATE TABLE readings (
  id INTEGER PRIMARY KEY,
  device_id TEXT,
  level INTEGER
);
