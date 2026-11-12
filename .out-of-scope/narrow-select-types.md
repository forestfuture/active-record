# Narrower record types for `select()`

A Relation built with `select(...)` keeps the Model's full record type. The type doesn't narrow to the selected attributes. Reading an attribute that wasn't loaded throws `MissingAttribute` at runtime, as the contract's "Partial records" section says.

```ts
const users = await db.model(User).select("email").toArray();
users[0].email; // loaded
users[0].name; // compiles, and throws MissingAttribute
```

## Why this is out of scope

**Rails does the same.** Rails raises `MissingAttributeError` when code reads an unselected attribute, and doesn't track selected columns in a record's class. Open behavior questions here follow Rails.

**It would add a type parameter everywhere.** `Relation<M, S>` already carries the Model's scope methods in `S`. Narrowing would need a third parameter for the selected attribute names, threaded through `Scoped`, every chaining method, associations, preloading and the record type each terminal returns. Record methods typed against the full Model (`attributeWas`, `isAttributeChanged`, `update`) would each need a partial variant.

**The narrowed type would still be wrong.** A partial record's loaded attributes change at runtime:

- `includes` loads the keys preloading needs, even when `select` leaves them out.
- Assigning an unloaded attribute makes it loaded (and dirty).
- `reload()` loads the full row.
- `select(...).distinct()` leaves out the primary key, which is otherwise always loaded.

A static type can't follow all of these, so code would need casts to get around it. The runtime error stays the single source of truth.

## Prior requests

- #13: "Narrower record types for select() (partial records)"
