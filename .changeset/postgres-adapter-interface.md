---
"@forestfuture/active-record": patch
---

The adapter interface (`@forestfuture/active-record/adapter`, unstable) takes what the PostgreSQL adapter needs: a dialect writes its own placeholders and links keys of different types, a driver can hold a connection for a `withDatabase` scope, and `workersEnv()` tells a Worker from Node. Nothing changes for an app on D1.
