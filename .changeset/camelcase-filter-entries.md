---
"@forestfuture/active-record": patch
---

A `filterAttributes` string written in camelCase now hides its attribute (#397). An entry was matched against the attribute's snake_case name as written, so `"secretAt"` hid nothing in `secret_at`, with no warning, and the value stayed in `onQuery` events and error messages. A string is now read in snake_case too: `"secretAt"`, `"secret_at"` and `"secret"` all match `secretAt`. Lowercase entries, the defaults among them, match as before.
