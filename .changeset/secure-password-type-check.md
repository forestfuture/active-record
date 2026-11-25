---
"@forestfuture/arbor": patch
---

`securePassword` on an attribute whose type isn't `string`, such as `{ type: "integer", virtual: true, securePassword: true }`, is now a compile error, in `define`, and in a generated Model's `static attributes`, where TypeScript reports it at the generated `interface` line, as it already was an `InvalidModel` when the Model was first used. A spec with a type and `securePassword` is also no longer typed as having a confirmation and a challenge, which it never had.
