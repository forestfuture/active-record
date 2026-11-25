---
"@forestfuture/arbor": minor
---

A new `uuid` attribute type holds a UUID as lowercase text with hyphens. On Postgres, `arbor schema` gives a `UUID` column a `uuid` attribute, so looking a record up by text that isn't a UUID finds nothing (`find` throws `RecordNotFound`, `findBy` resolves to `null`) instead of throwing Postgres's "invalid input syntax for type uuid" error. Assigning text that isn't a UUID throws `TypeError`. Run `npx arbor schema` on Postgres to regenerate the schema. See https://arbor.forestfuture.dev/upgrading.
