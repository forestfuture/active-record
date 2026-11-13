---
"@forestfuture/active-record": patch
---

Default scopes (#25): `this.defaultScope((q) => q.where({ deletedAt: null }))` in a Model's `static {}` narrows every query on it, its associations' reads and preloads included, and gives new records its equality values. `Model.unscoped()` starts a query without it. `reload`, uniqueness validation, and a record's own update and destroy ignore it.
