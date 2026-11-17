---
"@forestfuture/active-record": patch
---

Find a record, or make it (#346): `findOrCreateBy(attrs)` finds the record with those attributes, or creates one with them; `findOrCreateByOrThrow` throws `RecordInvalid` when it can't save, and `findOrInitializeBy` builds without saving. Where two requests may create at once, `createOrFindBy(attrs)` (and `createOrFindByOrThrow`) inserts first and, when a UNIQUE index refuses the duplicate, finds the existing record; leave a `uniqueness` validation off those attributes, or it refuses first. `createWith(attrs)` gives the records a Relation builds, creates, or inserts more attributes, without searching by them: `User.createWith({ role: "member" }).findOrCreateBy({ email })`. Each takes an `init` function last, as do `build`, `create`, and `createOrThrow`, which gets the new record before it's saved. They're Relation methods, so Model statics, on scopes, and through a `hasMany`.
