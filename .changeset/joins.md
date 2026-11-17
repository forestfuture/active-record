---
"@forestfuture/active-record": patch
---

Joins (#24): `joins()` and `leftJoins()` join declared associations, nested as `includes` names them, with each association's scope and its Model's default scopes in the join. `merge()` takes a Relation of a Model the query joins once, adding its conditions and order on the joined table, so `Post.joins("author").merge(User.where({ role: "admin" }))` filters by the author in one query. A joined query loads only its own Model's columns; a `hasMany` join repeats a record for each linked one, and `distinct()` removes them. Merging a Model that isn't joined, a merged Relation's `limit`, `select` or `includes`, `distinct()` with a joined Model's order, and a join to another database throw `IncompatibleRelation` when the query is written.
