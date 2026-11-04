-- Tables only the conformance suite's tests use, applied after the fixture schema.
CREATE TABLE stamps (id INTEGER PRIMARY KEY, name TEXT, seconds INTEGER, milliseconds INTEGER);

CREATE TABLE entries (id INTEGER PRIMARY KEY, title TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);

CREATE TABLE json_docs (id INTEGER PRIMARY KEY, folder_id INTEGER, settings TEXT, secret TEXT);

CREATE TABLE json_folders (id INTEGER PRIMARY KEY);

CREATE TABLE guarded_stamps (id INTEGER PRIMARY KEY, seconds INTEGER, milliseconds INTEGER, mapped_at INTEGER, iso TEXT);

CREATE TABLE typed_posts (id INTEGER PRIMARY KEY, title TEXT, published_at TEXT, seconds INTEGER, milliseconds INTEGER, featured INTEGER, rating INTEGER, score REAL, meta TEXT, secret TEXT);

CREATE TABLE typed_samples (id INTEGER PRIMARY KEY, label TEXT, enabled INTEGER, settings TEXT, stamp TEXT, secret TEXT);
