---
"@forestfuture/active-record": patch
---

A `filterAttributes` string written in camelCase now hides its attribute (#397). An entry was matched lowercased against the attribute's snake_case name, so `"secretAt"` hid nothing in `secret_at`. The value stayed in `onQuery` events and error messages, and nothing warned. A string now also matches read in snake_case: `"secretAt"`, `"secret_at"`, and `"secret"` all match `secretAt`. Every entry that matched before still does.
