---
"@forestfuture/active-record": patch
---

`afterFind` and `afterInitialize` callbacks (#49), as Rails' `after_find` and `after_initialize`: every record loaded (by a query, an association read, a preload, or `reload()`) runs `afterFind`, then `afterInitialize`, and every record built runs `afterInitialize`, after `build`'s or `create`'s `init`. Both run synchronously, so an `async` one is a type error. `record.hasAttribute(name)`, as Rails' `has_attribute?`, says whether a record from `select(...)` loaded an attribute.
