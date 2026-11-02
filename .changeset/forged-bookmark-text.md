---
"@forestfuture/d1-record": patch
---

A bookmark D1 rejects now starts the Session again even when it reads like a constraint failure. A forged cookie could make a request's first statement throw `RecordNotUnique` or another constraint error.
