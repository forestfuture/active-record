---
"@forestfuture/active-record": patch
---

A hasOne takes `touch` (#497), as Rails' `has_one … touch:`: `hasOne(Profile, { touch: true })` sets the profile's `updatedAt` whenever its user is updated, destroyed, or touched, in the user's own atomic batch. `touch: "lastSeenAt"`, or a list, sets those attributes too. The profile runs its `afterTouch` and update commit callbacks. A created user touches nothing. A profile the user's own save writes (built through it, or autosaved), or the user's `dependent` removes, is left to that write; one saved as another entry of the same batch is still touched.
