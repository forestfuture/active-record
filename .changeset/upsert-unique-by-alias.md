---
"@forestfuture/arbor": patch
---

An upsert whose `uniqueBy` names an attribute alias now leaves that attribute out of what it updates, as it does when `uniqueBy` names the attribute itself. When a clashing row gives nothing else to update, `upsert` and `upsertAll` now leave it as it is, and don't count or return it.
