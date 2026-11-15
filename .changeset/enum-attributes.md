---
"@forestfuture/active-record": minor
---

Enum attributes (#340). Declare one with `enum`, in an override (`status: { enum: ["draft", "published"] }`) or in `define`, with names stored as text or mapped to integers (`{ low: 0, high: 10 }`). Its property is typed as the union of its names, an unknown value throws `TypeError` when it's assigned, and a stored value the enum doesn't list reads as `null`. Each name gives records `isPublished()` and `saveAsPublished()` / `saveAsPublishedOrThrow()`, and the Model `published()` and `notPublished()` scopes; `Post.enumValues("status")` gives the names with their stored values. `prefix`, `suffix`, `scopes: false`, `instanceMethods: false` and `validate: true` work as Rails' options do.

The generated `schema.ts` is now a `defineSchema({ … })` call, which makes a generated Model's enum scopes statics from the start. Run `npx active-record schema` to regenerate yours; `--check` reports a schema an older version wrote.
