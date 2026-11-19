---
"@forestfuture/active-record": patch
---

Around callbacks (#48), as Rails' `around_save`, `around_create`, `around_update`, and `around_destroy`: `this.aroundSave(async (order, next) => { …; await next(); … })` runs code on both sides of a write. `next()` runs the rest of the save and resolves once the database has kept its batch; in a `batch()`, every record's first part runs before the one write. Not calling `next()` stops the save, as `abort()` does. When the write is refused, or never sent because another record was refused, `next()` rejects with the save's error.
