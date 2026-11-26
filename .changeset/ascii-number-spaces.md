---
"@forestfuture/arbor": minor
---

An `integer`, `real` or `decimal` attribute reads only ASCII whitespace (space, tab, line feed, vertical tab, form feed and carriage return) around a number in text, as Postgres and SQLite do. Text with a no-break space or another Unicode space around its number, such as `" 42"`, is now refused when it's assigned. As a condition it finds nothing, and `whereNot` with it excludes nothing, so a condition and a link between a text key and a number key agree on it. On D1, a `DECIMAL` cell that holds such text fails to load. Call `trim()` on such text first to keep reading its number.
