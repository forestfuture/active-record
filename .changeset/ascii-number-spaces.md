---
"@forestfuture/arbor": minor
---

An `integer`, `real` or `decimal` attribute reads only ASCII whitespace (space, tab, line feed, vertical tab, form feed and carriage return) around a number in text, as Postgres and SQLite do. Text with a no-break space or another Unicode space around its number, such as `"\u00a042"`, is now refused when it's assigned, and finds nothing as a condition, so a condition and a link between a text key and a number key agree on it. Call `trim()` on such text first to keep reading its number.
