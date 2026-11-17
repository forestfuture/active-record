---
"@forestfuture/active-record": patch
---

Associations through another (#59): `projects = hasMany(Project, { through: "assignments" })` reaches the projects a user's assignments point at, and `hasOne(Profile, { through: "user" })` one record. `source` names the join Model's association when it isn't named as this one, singular or plural. It goes through a `belongsTo`, `hasMany` or `hasOne`, to any kind of source, and can go through or to another through association. Reads are one query with subqueries and return each record once; `includes` preloads it with a query per hop, in the owners' round trip on D1. Every hop must be on one database for now.
