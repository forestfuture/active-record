---
"@forestfuture/active-record": patch
---

A belongsTo takes `touch` (#353), as Rails' `belongs_to … touch:`: `belongsTo(Article, { touch: true })` sets the article's `updatedAt` whenever a comment is created, updated, destroyed, or touched, in the comment's own atomic batch. `touch: "lastCommentedAt"`, or a list, sets those attributes too. The article is loaded first when it isn't, so it runs its `afterTouch` and update commit callbacks, and touches the records its own `belongsTo`s touch in turn. With a counter cache on the same `belongsTo`, the time is set in the counter's `UPDATE`.
