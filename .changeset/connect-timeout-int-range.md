---
"@forestfuture/arbor": minor
---

The PostgreSQL adapter refuses a connection string's `connect_timeout` that doesn't fit libpq's `int`, from -2147483648 to 2147483647 seconds, as libpq does. A value such as `connect_timeout=99999999999` now throws `TypeError` when the Database is built, where it used to wait about 24 days, the longest a timer waits. Use a smaller number, or `connect_timeout=0` for no limit.
