---
"@forestfuture/d1-record": patch
---

A bookmark D1 rejects no longer passes for a constraint failure. A forged cookie could make a request's first statement throw `RecordNotUnique` or another constraint error, and now starts the Session again. A bookmark given to `connect` throws D1's error.
