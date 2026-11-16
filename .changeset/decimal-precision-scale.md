---
"@forestfuture/active-record": patch
---

A decimal's `precision` and `scale` (#398): `{ type: "decimal", precision: 10, scale: 2 }` rounds an assigned value to two places, half away from zero, as Postgres's `NUMERIC(10, 2)` does, so a saved record holds what the database stores. A value with more than eight digits before the point throws `TypeError`. `active-record schema` reads both from a column's size, and `g` writes `'price:decimal{10,2}'` as `DECIMAL(10, 2)` or `NUMERIC(10, 2)`.
