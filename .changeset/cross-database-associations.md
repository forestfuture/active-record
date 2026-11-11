---
"@forestfuture/active-record": patch
---

An association between Models on different databases now reads and writes the target's database (#228), on the same adapter or another. Before, every query through it went to the owner's database. Reads, `includes` (one more round trip for each other database a tree reaches), creating through the association, autosave, and every `dependent:` strategy work across databases, as in Rails: each database's writes are separate, so not atomic together. A `batch` or `db.batch`, which writes one database atomically, refuses a save or destroy whose records reach another database, with `IncompatibleRelation`.
