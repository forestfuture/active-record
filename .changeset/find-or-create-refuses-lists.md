---
"@forestfuture/active-record": patch
---

Find-or-create refuses condition values (#433): `findOrCreateBy`, `findOrCreateByOrThrow`, `findOrInitializeBy`, `createOrFindBy`, and `createOrFindByOrThrow` throw a `TypeError` for a list, a comparison, or a `sql` fragment in their attributes, before anything is sent. Their find read a list as `IN`, so a request body passed without `permit` could find another user's row. An array the attribute takes as one value, a `json` attribute's or a custom type's, is now found as that value, so the record created with it is found next time. Attributes that aren't an object throw a `TypeError` too.
