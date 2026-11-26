-- ../sqlite/uuids.sql with UUID columns, which refuse text that isn't a UUID.
CREATE TABLE devices (
  id UUID PRIMARY KEY,
  name TEXT,
  readings_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ
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
