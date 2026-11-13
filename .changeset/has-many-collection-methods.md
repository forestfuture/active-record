---
"@forestfuture/active-record": patch
---

A `hasMany` has collection methods (#352): `user.posts().push(post)` sets the post's foreign key and saves it (on a new owner, it's saved with the owner), `delete(post)` removes it by the association's `dependent:` (nullifying by default), `destroy(post)` destroys it with its callbacks, and `clear()` removes every post as `deleteAll()` does. Each keeps a loaded collection in step. They're on the association itself only, typed as `HasManyCollection`.
