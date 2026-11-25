---
"@forestfuture/arbor": patch
---

`securePassword` on an attribute whose type isn't `string`, such as `{ type: "integer", virtual: true, securePassword: true }`, is now a compile error, as it already was an `InvalidModel` when the Model was first used.
