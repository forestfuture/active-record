---
"@forestfuture/arbor": minor
---

On Postgres, a `boolean`, `date`, `time`, `datetime` (one without `storage`), `json` or `binary` key linked either way to a key of another type (such as a text foreign key pointing at a date) matches nothing in a preload, a join or a through association, rather than failing with "operator does not exist". A lazy read still links such keys as a condition does.

For adapters: a `Dialect`'s `linkedKey` may return `undefined` for a link that matches nothing, and `Attribute#storedType` gives the type an attribute's column holds it as. `Attribute#isUuid` is removed; read `storedType === "uuid"` instead.
