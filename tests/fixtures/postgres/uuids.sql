-- ../sqlite/uuids.sql with UUID columns, which refuse text that isn't a UUID.
CREATE TABLE devices (
  id UUID PRIMARY KEY,
  name TEXT
);
