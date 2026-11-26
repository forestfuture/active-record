---
"@forestfuture/arbor": patch
---

On Postgres, a `uuid` key now links to a `string` foreign key, such as a polymorphic `TEXT` id, in preloads and joins, where it failed with `operator does not exist: uuid = text`. Text finds its record when it holds the UUID lowercase with hyphens, as on D1. Text in another form, or that isn't a UUID, finds nothing. A `uuid` linked to an `integer` finds nothing rather than failing. Declare a `UUID` column as a `uuid` attribute, as `arbor schema` does: a `string` attribute over one can't be linked to a `uuid`.
