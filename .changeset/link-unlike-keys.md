---
"@forestfuture/arbor": patch
---

On Postgres, a key linked to a `boolean`, `date`, `time`, `datetime`, `json` or `binary` key of another type (such as a text foreign key pointing at a date) matches nothing, rather than failing with "operator does not exist". An adapter's `Dialect` may return `undefined` from `linkedKey` for such a link, and `Attribute#storedType` gives the type an attribute's column holds it as.
