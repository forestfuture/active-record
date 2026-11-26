---
"@forestfuture/arbor": minor
---

The PostgreSQL adapter reads only ASCII whitespace (space, tab, line feed, vertical tab, form feed and carriage return) around the number in a connection string's `connect_timeout`, as libpq does. A value with a no-break space or another Unicode space around its number, such as `connect_timeout=%C2%A05`, now throws `TypeError` when the Database is built, as any value that isn't a whole number does, where it used to set the limit. Remove the space from the connection string.
