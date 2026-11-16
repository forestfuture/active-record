---
"@forestfuture/active-record": patch
---

Calculations (#344): `sum`, `average`, `minimum` and `maximum` of an attribute or an `sql` fragment, and `calculate(operation, attribute)`, on a Relation and as Model statics. Each sends one query over the rows `toArray()` would return, so a `limit`, an `offset` or `distinct()` picks the values. A sum is the attribute's own value (a decimal's text, exact on Postgres and to about 15 digits on D1; a custom type's value), 0 with no rows; `minimum` and `maximum` read as the attribute does (a `Date` for a datetime), and `average` is a number, each `null` with no rows. `none()` answers without a query. `sum` and `average` take number attributes, and `minimum` and `maximum` any but booleans, json and bytes: another is a compile error and a `TypeError`.
