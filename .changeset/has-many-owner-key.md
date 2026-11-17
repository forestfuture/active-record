---
"@forestfuture/active-record": minor
---

A record built, created, or inserted through a `hasMany` always gets its owner's key (#346), as one built through a `hasOne` already did. Breaking: a foreign key passed along, as in `user.posts().build({ userId: otherId })`, is now replaced by the owner's instead of kept. Build a record for another owner through that owner, or through the Model.
