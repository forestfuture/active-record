---
"@forestfuture/active-record": minor
---

Inside `withDatabase`, a read whose SQL and bound values match one already sent on that database is answered from memory, with no round trip, until a write clears it. Each answer is new records. `onQuery` hears a cached answer with `cached: true`. Any write Active Record sends clears the cache, and so does `reload()`. A write you send yourself on the binding or a `pg` client doesn't, so call the new `db.clearRequestCache()` after one. Turn the cache off with `connect(env.DB, { cache: { request: false } })`.
