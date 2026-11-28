---
"@forestfuture/arbor": minor
---

An association may link keys of different types only when one is text and the other an `integer` (a `datetime` kept as a Unix time included) or a `uuid`, a mixed-type link. Any other pair, such as text and a `date`, a `real` or a `decimal`, or an `integer` and a `uuid`, now throws `InvalidModel` when the Model is first used, naming the attribute to declare the foreign key like.

A mixed-type link now compares its keys as text everywhere, on D1 and Postgres alike: text links to an integer or a uuid only in that key's own form, so `"09"` and `" 9"` link to no 9, in a lazy read, a preload, a join and a through association, and copying such text into an integer or uuid key throws `TypeError`. A join or a through association casts the integer or uuid side to text, so that side's index isn't searched. A preload of a mixed-type link selects by the loaded records' keys, so on D1 it takes one more round trip. A counter cache over one counts by the key its record last saved, so on Postgres destroying the record or changing its key no longer fails with `operator does not exist`.

For adapters: `Dialect#linkedKey` is only asked about keys of one kind and always returns a string, and `Attribute#isText` is removed.
