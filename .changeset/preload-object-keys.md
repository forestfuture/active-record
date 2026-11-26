---
"@forestfuture/arbor": patch
---

A preload (`includes`, or a through association) now attaches the records whose key holds the same value when the key is a `json`, `datetime` or `binary` attribute. It used to attach none, though a join or a lazy read found them.
