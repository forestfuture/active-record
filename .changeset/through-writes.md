---
"@forestfuture/active-record": patch
---

Write through an association that goes through a join Model (#434), as Rails' `has_many :through` does. `user.projects().push(project)`, `build` and `create` make the assignment that links them; `delete(project)`, `clear()` and the association's own `deleteAll()` delete the user's assignments without callbacks, and `destroy(project)` destroys them with their callbacks. The projects stay. A `hasMany` through another takes `dependent: "destroy"` or `"deleteAll"`, which acts on its join records, and a `hasOne` through another has `set`. Writes need a `hasMany` (or a `hasOne`, for a `hasOne`) followed by a `belongsTo`, neither going through another; the rest, and `insert` and `upsert` through any association through another, throw `ReadonlyAssociation`.
