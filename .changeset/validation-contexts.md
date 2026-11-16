---
"@forestfuture/active-record": patch
---

Run a validation only when creating or updating, or in a context of your own (#51). `validates` and `validatesAssociated` take `on` and `exceptOn`, and `beforeValidation` and `afterValidation` take `{ on }`. A record is validated in `"create"` while it's new and `"update"` once saved, or in the context given to `isValid(context)`, `save({ context })` or `saveOrThrow({ context })`. A Model lists its own contexts in `static validationContexts = [...] as const`, so a misspelled one is a compile error in a declaration, and a `TypeError` in `isValid` or `save`.
