---
"@forestfuture/active-record": minor
---

A new record's changes run from its declared defaults and generated ids (#41), as in Rails: `Post.build()` holding only defaults isn't changed, and assigning a default's value isn't a change. Inserts still write them. After a create, `savedChanges()` is what the insert changed plus what the write or the database filled in (a generated key, timestamps), not the defaults the record kept.

Breaking: code reading a new record's `changes()`, `changed()`, `isChanged()` or `savedChanges()` no longer sees its kept defaults or generated id.
