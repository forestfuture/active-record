---
"@forestfuture/active-record": patch
---

Commit and rollback callbacks (#341). `afterCommit`, `afterCreateCommit`, `afterUpdateCommit`, `afterSaveCommit` and `afterDestroyCommit` run last, once a write is kept: after every after-callback of the save, or of every record in a batch, in the order they were declared. `afterRollback` runs for each record whose save or destroy the database refused, such as for a constraint error or another write in its batch. It doesn't run for a failed validation or an `abort()`, since nothing was sent. An error a callback throws while a refused write is handled reaches the caller in place of the database's error, which becomes its `cause`.
