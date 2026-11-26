-- JSON keys in TEXT columns, which an app may keep JSON in, and in JSON columns, which have no
-- equality (#591).
CREATE TABLE text_shelves (id INTEGER PRIMARY KEY, label TEXT);
CREATE TABLE text_books (id INTEGER PRIMARY KEY, shelf_label TEXT);
CREATE TABLE json_shelves (id INTEGER PRIMARY KEY, label JSON);
CREATE TABLE json_books (id INTEGER PRIMARY KEY, shelf_label JSON);
