---
"@forestfuture/arbor": patch
---

An upsert whose `uniqueBy` names an attribute alias now leaves that attribute out of what it updates, as it does when `uniqueBy` names the attribute itself. A clashing row that gives nothing else to update is now left as it is, so `upsertAll` no longer returns it.
