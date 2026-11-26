---
"@forestfuture/arbor": minor
---

The PostgreSQL adapter reads a `+` in a connection string's `connect_timeout` as a `+`, as libpq does, rather than as a space. A value with a `+` after its number or before its sign, such as `connect_timeout=5+` or `connect_timeout=+-5`, now throws `TypeError` when the Database is built, where it used to set a limit (or none). `connect_timeout=+5` still sets 5 seconds. Remove the `+` from the connection string.
