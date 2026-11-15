---
"@forestfuture/active-record": minor
---

`active-record schema` reads enums from the database (#64). A column whose values a Postgres enum type, or a `CHECK (column IN ('open', 'done'))` on D1 or Postgres, restricts to a list of strings becomes a generated enum: its spec lists the names, with `scopes: false` and `instanceMethods: false`, so its type is the union of the names and assigning any other value throws `TypeError`. Its Model turns the predicates, setters, and scopes on with an override's `enum: true`, or drops the enum with `enum: false`.

Regenerating an existing schema narrows such columns to their names, so code that assigned other text to one now throws `TypeError`; override the column with `enum: false` to keep it a plain string. A clashing enum method name now also suggests leaving its methods out (`scopes: false, instanceMethods: false`).
