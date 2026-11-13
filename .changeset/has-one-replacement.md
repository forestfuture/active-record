---
"@forestfuture/active-record": minor
---

A `hasOne` replaces its record as Rails does (#40). `await user.profile.set(profile)` gives the owner another record, and `set(null)` removes it. On a saved owner, `set`, `build` and `create` remove the old record by `dependent:`: `"destroy"` destroys it, `"delete"` deletes it, and otherwise its foreign key is set to `null` and it's saved. It's removed in the same atomic batch that writes the new record: at once for `set` and `create`, and for `build` when the owner is saved. An old record that can't be saved with a `null` foreign key throws `RecordNotSaved`, and nothing is written.

Breaking: `build` and `create` through a saved owner's `hasOne` used to leave the old record as it was. Set `dependent` on each `hasOne` whose old records you keep.
