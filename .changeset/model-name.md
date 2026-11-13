---
"@forestfuture/active-record": patch
---

A Model's `modelName` is its name (#47): its class name, unless it sets `static override modelName = "BlogPost"`. Its table name, its `hasMany` and `hasOne` foreign keys, its entry in the generated schema's `models`, and `%{model}` in its error messages are made from it, so a Model that sets it keeps working with a bundler that renames classes. A subclass inherits a `modelName` its parent sets; otherwise each class reads its own name.
