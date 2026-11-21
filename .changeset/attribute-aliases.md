---
"@forestfuture/active-record": patch
---

Give an attribute a second name with `aliasOf` (#509): `static override attributes = { title: { aliasOf: "name" } } as const`, or the same in `define`. The alias reads and writes the attribute, typed as it, and queries, writes, validations, and change tracking take either name. `attributes()`, `toJSON()`, and `changes()` list the attribute's own name.
