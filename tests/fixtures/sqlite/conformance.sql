-- Tables only the conformance suite's tests use, applied after the fixture schema.
CREATE TABLE stamps (id INTEGER PRIMARY KEY, name TEXT, seconds INTEGER, milliseconds INTEGER);

CREATE TABLE entries (id INTEGER PRIMARY KEY, title TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);

CREATE TABLE json_docs (id INTEGER PRIMARY KEY, folder_id INTEGER, settings TEXT, secret TEXT);

CREATE TABLE json_folders (id INTEGER PRIMARY KEY);

CREATE TABLE guarded_stamps (id INTEGER PRIMARY KEY, seconds INTEGER, milliseconds INTEGER, mapped_at INTEGER, iso TEXT);

CREATE TABLE typed_posts (id INTEGER PRIMARY KEY, title TEXT, published_at TEXT, seconds INTEGER, milliseconds INTEGER, featured INTEGER, rating INTEGER, score REAL, meta TEXT, secret TEXT);

CREATE TABLE typed_samples (id INTEGER PRIMARY KEY, label TEXT, enabled INTEGER, settings TEXT, stamp TEXT, secret TEXT);

-- An enum stored as text (status) and one stored as integers (priority), #340.
CREATE TABLE articles (id INTEGER PRIMARY KEY, title TEXT, status TEXT, priority INTEGER);

-- Bytes (#20): a file's contents (data) and a hash to look one up by (digest).
CREATE TABLE attachments (id INTEGER PRIMARY KEY, name TEXT, data BLOB, digest BLOB);

-- Custom types (#20): a price kept as integer cents, and a list of sizes kept as text.
CREATE TABLE listings (id INTEGER PRIMARY KEY, title TEXT, price INTEGER, sizes TEXT);

-- Dates, decimals and times (#391): an amount, the day it's booked on, and when it starts.
CREATE TABLE ledger_lines (id INTEGER PRIMARY KEY, label TEXT, amount DECIMAL, booked_on DATE, starts_at TIME, price DECIMAL(10, 2));

-- Calculations (#344): a column named like the alias a calculation selects its values as.
CREATE TABLE readings (id INTEGER PRIMARY KEY, value INTEGER, price INTEGER);

-- Associations through another (#59): users' projects through their assignments.
CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0);
CREATE TABLE assignments (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users (id), project_id INTEGER REFERENCES projects (id), role TEXT);

-- Polymorphic associations (#60): a remark on a post or a photo, by its type and id.
CREATE TABLE photos (id INTEGER PRIMARY KEY, title TEXT);
CREATE TABLE remarks (id INTEGER PRIMARY KEY, body TEXT, commentable_type TEXT, commentable_id INTEGER, user_id INTEGER);

-- Upserts through a hasMany on another unique index (#451): a slug unique everywhere, a label per user.
CREATE TABLE badges (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users (id), slug TEXT UNIQUE, label TEXT, UNIQUE (user_id, label));

-- Counter caches (#61): each topic keeps a count of its replies.
CREATE TABLE topics (id INTEGER PRIMARY KEY, title TEXT, number INTEGER, replies_count INTEGER DEFAULT 0, reply_tally INTEGER, reactions_count INTEGER, updated_at TEXT, seen_at TEXT);
CREATE TABLE replies (id INTEGER PRIMARY KEY, topic_id INTEGER REFERENCES topics (id), body TEXT NOT NULL);
-- A reaction to a topic or a picture, counted on whichever it's on.
CREATE TABLE pictures (id INTEGER PRIMARY KEY, reactions_count INTEGER DEFAULT 0);
CREATE TABLE reactions (id INTEGER PRIMARY KEY, reactable_type TEXT, reactable_id INTEGER);
-- Cards pinned to boards, each board counting its pins.
CREATE TABLE boards (id INTEGER PRIMARY KEY, pins_count INTEGER DEFAULT 0);
CREATE TABLE cards (id INTEGER PRIMARY KEY);
CREATE TABLE pins (id INTEGER PRIMARY KEY, board_id INTEGER REFERENCES boards (id), card_id INTEGER REFERENCES cards (id));
-- A belongsTo's touch (#353): forums' discussions and discussions' messages, each touching its parent.
CREATE TABLE forums (id INTEGER PRIMARY KEY, title TEXT, updated_at TEXT, last_activity_at TEXT);
CREATE TABLE discussions (id INTEGER PRIMARY KEY, forum_id INTEGER, title TEXT, archived INTEGER DEFAULT 0, messages_count INTEGER DEFAULT 0, updated_at TEXT, last_message_at TEXT);
CREATE TABLE messages (id INTEGER PRIMARY KEY, discussion_id INTEGER, body TEXT, updated_at TEXT);
CREATE TABLE stickers (id INTEGER PRIMARY KEY, stickable_type TEXT, stickable_id INTEGER, updated_at TEXT);
