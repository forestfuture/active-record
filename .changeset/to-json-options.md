---
"@forestfuture/arbor": patch
---

`toJSON()` takes options: `include` sends loaded associations (`user.toJSON({ include: "posts" })`), `only` and `except` pick the attributes sent, and `methods` adds getters' and methods' values. An association that wasn't preloaded throws `AssociationNotLoaded`, and a name the Model doesn't have throws `TypeError`.
