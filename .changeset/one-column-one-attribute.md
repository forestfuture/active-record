---
"@forestfuture/arbor": minor
---

`Model.define` now throws `InvalidModel` when two attributes map to one column, whether through `column` or through names that map to the same one, such as `userId` and `userID`. A second attribute on a column could write it where the first can't be written: an upsert could change the primary key, and a save could change a read-only attribute. To give a column a second name, declare an alias, `legacyId: { aliasOf: "id" }`.
