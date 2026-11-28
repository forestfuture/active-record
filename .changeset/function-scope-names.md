---
"@forestfuture/arbor": patch
---

A scope named like a method every class has, such as `bind`, `call` or `apply`, now throws `InvalidModel` when the Model is first used, naming the scope. It used to replace that method on the Model and its subclasses, so `Post.bind(…)` built a Relation instead of binding.
