---
"@forestfuture/active-record": patch
---

Declare an attribute that isn't a column with `virtual: true` (#356), such as a form's `termsOfService` checkbox: `static override attributes = { termsOfService: { type: "boolean", virtual: true } } as const`, or the same in `define`. It's typed, cast, change-tracked and taken by `permit`, but never saved, never loaded from a row, and refused in a query. The new `confirmation` validator compares an attribute with its virtual confirmation (`email` with `emailConfirmation`), and `toJSON()` leaves that confirmation out.
