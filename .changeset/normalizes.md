---
"@forestfuture/active-record": patch
---

Normalize an attribute's values with `this.normalizes("email", { with: (email) => email.trim().toLowerCase() })` in a Model's `static {}` (#354). Each value assigned to it is normalized once cast: through the setter, `build`, `create`, `update`, a default, and bulk writes such as `insert` and `updateAll`. A query's values are normalized as well, so `findBy({ email: " Jane@Example.com" })` finds `jane@example.com`. `null` is left alone unless `applyToNull: true`. `Model.normalizeValueFor(name, value)` returns a value normalized, and `record.normalizeAttribute(name)` normalizes a value loaded from a row stored before the normalization was declared.
