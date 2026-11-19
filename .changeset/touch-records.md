---
"@forestfuture/active-record": patch
---

Touching records (#50). `record.touch()` sets `updatedAt`, and any datetime attributes named, to now (or `{ time }`) without a save, then runs `afterTouch` and the update commit callbacks. A Relation's `touchAll()` touches every row it matches in one statement, and `incrementColumn` and `decrementColumn` take `{ touch }`.
