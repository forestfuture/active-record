---
"@forestfuture/active-record": minor
---

A bulk write through a Relation (`insert`, `insertAll`, `upsert` and `upsertAll`, and their batch forms) now writes the Relation's equality values, its `createWith` attributes and its default scope's values over the attributes you pass, as Rails' `insert_all` does. `Post.where({ userId: 1 }).insert({ title: "Hi", userId: 2 })` now writes `userId: 1`. `build` and `create` still use the values you pass. See the upgrading guide.
