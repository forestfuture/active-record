---
"@forestfuture/arbor": minor
---

The PostgreSQL adapter refuses a connection string's `connect_timeout` outside -2147483648 to 2147483647 seconds, the range of libpq's `int`. libpq refuses it too. A value such as `connect_timeout=99999999999` now throws `TypeError` when the Database is built. Before, a larger number waited about 24 days, and a smaller one set no limit. Use a smaller number, or `connect_timeout=0` for no limit.
