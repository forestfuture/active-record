---
"@forestfuture/active-record": patch
---

`group` and `having` (#345). `Order.group("status").count()` resolves to a `Map` from each group's value to its count, such as `Map { "paid" => 3, "open" => 1 }`, and `sum`, `average`, `minimum`, `maximum` and `calculate` work per group the same way. Group by several attributes for tuple keys, or by an `sql` fragment. ``having(sql`COUNT(*) > ${1}`)`` keeps the groups its fragment matches, and an order or limit sorts and picks the groups.
