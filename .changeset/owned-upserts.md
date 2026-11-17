---
"@forestfuture/active-record": patch
---

`upsert` and `upsertAll` through a `hasMany` only update the owner's records (#451). A row that clashed with another owner's record used to take that record over, writing the owner's key into it. Now that record is left as it is, and the row isn't counted or returned. A record built, created, inserted, or upserted through a `hasMany` with `as` also gets its owner's type over a given one, as it gets its owner's key.
