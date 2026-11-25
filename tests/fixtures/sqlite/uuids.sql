-- Keys that are UUIDs: text on D1, which has no UUID type (../postgres/uuids.sql declares them UUID).
CREATE TABLE devices (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT
);

-- A text foreign key (device_id) and an integer one (level), each pointing at a UUID key (#563).
CREATE TABLE readings (
  id INTEGER PRIMARY KEY,
  device_id TEXT,
  level INTEGER
);
