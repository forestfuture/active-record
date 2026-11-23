---
"@forestfuture/active-record": patch
---

Add read-only records and attributes (#358). `Relation.readonly()` marks the records it loads, and `record.markReadonly()` marks one; `isReadonly()` reads the mark. Saving, updating, destroying or touching a read-only record, or writing its columns, throws `ReadonlyRecord` (`.record`, `.action`) before validation or any callback runs, and so does a save, batch or `push` that would write one through its associations. Bulk writes ignore the mark. An attribute declared `readonly: true` is written when its record is created; assigning a persisted record another value throws `ReadonlyAttribute` (`.attribute`), while assigning the value it holds is allowed, so a form can post it back. An upsert leaves a clashing row's read-only values alone.
