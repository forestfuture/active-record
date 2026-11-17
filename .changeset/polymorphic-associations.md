---
"@forestfuture/active-record": patch
---

Add polymorphic associations (#60). `commentable = belongsTo([Post, Photo])` points a record at a record of any listed Model, by a type attribute holding the Model's `modelName` (`commentableType`) and a foreign key (`commentableId`). Each listed Model reads its records with `hasMany(Comment, { as: "commentable" })` or `hasOne`. Reading, `set`, autosave, `dependent:`, collection methods and `includes` all work through it. A stored type that names no listed Model throws the new `UnknownModelName`.
