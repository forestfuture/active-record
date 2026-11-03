---
"@forestfuture/d1-record": minor
---

Bulk inserts resolve to the rows they wrote, and the base error is `ActiveRecordError`. Both are breaking changes.

- `insert`, `insertAll`, `upsert` and `upsertAll` resolve to `{ rowsAffected, rows }` in place of D1's `meta`. `rows` holds each written row's primary key, read as its type. Name other attributes with `returning: ["id", "createdAt"]`, which types `rows` too, or pass `returning: false` for none. Replace `meta.changes` with `rowsAffected`, and `meta.last_row_id` with `rows[0]?.id`.
- A statement's result in `db.batch` is the same `{ rowsAffected, rows }`. `rows` is empty for `toUpdateAll` and `toDeleteAll`.
- `D1RecordError` is now `ActiveRecordError`, with no alias. Rename it in `instanceof` checks.
- D1's `meta` is still on every `onQuery` event, typed `D1Meta`.
