---
"@forestfuture/active-record": minor
---

Lock records optimistically with a `lock_version` column (#357). A Model with an integer `lockVersion` attribute checks it on every save, destroy and `touch()`, and adds 1 to it: a copy loaded before another write changed its row throws `StaleRecord` (`.record`, `.action`), from `save()` and `destroy()` as from their `OrThrow` forms, and nothing in its write is kept. An assigned `lockVersion`, such as a form's hidden field, is the version checked. A NULL `lock_version` reads as 0. A belongsTo's or hasOne's `touch` of a locked record adds 1 to its version without checking it. This is a minor change because a table that already has a `lock_version` column starts locking.
