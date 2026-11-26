-- Keys that are UUIDs: text on D1, which has no UUID type (../postgres/uuids.sql declares them UUID).
CREATE TABLE devices (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT,
  readings_count INTEGER NOT NULL DEFAULT 0,
  updated_at DATETIME
);

-- A text foreign key (device_id), an integer one (level) and a polymorphic one (subject_type,
-- subject_id), each pointing at a UUID key (#563).
CREATE TABLE readings (
  id INTEGER PRIMARY KEY,
  device_id TEXT,
  level INTEGER,
  subject_type TEXT,
  subject_id TEXT
);
