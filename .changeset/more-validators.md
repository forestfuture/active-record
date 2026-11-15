---
"@forestfuture/active-record": patch
---

Four more validators for `validates` (#342), with Rails' messages:

- `exclusion: ["admin"]` (or `{ in: [...] }`) fails a listed value: "is reserved".
- `absence: true` fails anything `presence` would pass: "must be blank".
- `comparison: { greaterThan, greaterThanOrEqualTo, lessThan, lessThanOrEqualTo, equalTo, otherThan }` compares numbers, strings or Dates with a value or a function of the record, such as `{ greaterThan: (event) => event.startsAt }`. A null value is "can't be blank"; a bound that's null is skipped; values of different kinds throw `TypeError`. New messages: "must be equal to %{count}" and "must be other than %{count}".
- `acceptance: true` (or `{ accept: [...] }`) passes `true` and `"1"`, and `null` unless `allowNull: false`: "must be accepted".

Within one `validates` call, the rules run in this order: presence, absence, length, format, inclusion, exclusion, numericality, comparison, acceptance, uniqueness.
