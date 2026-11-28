---
"@forestfuture/arbor": patch
---

The guide and the agent skill say that empty attributes add no condition, so `findOrCreateBy({})` finds any record the Relation matches, as `findBy({})` does. Check that a request's body has the fields you query by.
