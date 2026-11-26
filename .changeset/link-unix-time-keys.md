---
"@forestfuture/arbor": patch
---

A `datetime` kept as a Unix time (`storage: "unixSeconds"` or `"unixMilliseconds"`) now links to an `integer` key through an association as the integer it stores, as a join already did. A preload, a lazy read, a touch and a counter cache find the record whose Unix time the key is, where they found nothing or threw `TypeError`, and building, creating, pushing or pointing a record through the association writes the integer. Deleting records through a through association that reaches them removes their join records, where it removed none. Linked to a `datetime` stored another way, a lazy read compares what each stores, as a join does, where it compared instants. A preload by a `datetime` or `binary` key now attaches its records, where it attached none. A counter cache whose foreign key no target can hold (text that isn't digits, for an `integer` key) now counts the new record in nowhere, where creating it threw `TypeError`.
