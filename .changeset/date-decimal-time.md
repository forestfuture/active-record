---
"@forestfuture/active-record": minor
---

`decimal`, `date` and `time` attributes (#391).

A `decimal` holds an exact number as text in one form: `"12.50"` reads as `"12.5"`. It's assigned decimal text or a `bigint` exactly, or a number at 16 significant digits (`0.1 + 0.2` is `"0.3"`). Conditions, comparisons and `order` compare decimals as numbers, and so do `numericality` and `comparison`. D1 keeps about 15 significant digits; Postgres's `numeric` keeps every one.

A `date` holds a day, `"2026-01-02"`, and a `time` a time of day, `"09:30:00"`, both as text with no zone. A `Date` is refused for either, since its day and time depend on the time zone.

`active-record schema` reads `NUMERIC` and `DECIMAL` columns as `decimal`, where they were errors, and `TIME` as `time`. `g` writes `price:decimal`, `starts_on:date` and `opens_at:time`, with `=value` defaults.

Breaking: `active-record schema` reads a `DATE` column as a `date`, where it was a `datetime`. Override it with `"datetime"` to keep a `Date`. On D1, a `DATE` column a `datetime` wrote holds `2026-01-02T00:00:00.000Z`, which a `date` can't read; the upgrading guide shows the SQL that keeps each day. A `TIME` column, read as a `string` before, reads as `"09:30:00"`.
