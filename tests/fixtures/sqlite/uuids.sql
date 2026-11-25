-- Keys that are UUIDs: text on D1, which has no UUID type (../postgres/uuids.sql declares them UUID).
CREATE TABLE devices (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT
);
