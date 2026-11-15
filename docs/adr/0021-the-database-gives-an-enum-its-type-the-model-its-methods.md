# The database gives an enum its type, the Model its methods

A column the database restricts to a set of strings (a Postgres enum type, or `CHECK (… IN …)`) gets a generated enum (#64): `active-record schema` writes its names with `scopes: false` and `instanceMethods: false`, so the attribute's type is the union and an unknown value is refused, but nothing is added to the Model's API until its override turns the methods on, with `enum: true` or the two keys.

Rails infers nothing from the database and declares every enum in the Model. We infer the type because a generated Model already takes its attributes from the database, and a list written again in the Model drifts from the one the database enforces. We leave the methods declared because a developer reading `Post.published()` should find where it comes from in the Model, and a migration shouldn't change a Model's API.

Inferring the methods too was weighed. They'd have no visible declaration, and an adopted database's labels could fail the first `schema` run on a clash with a name the app already uses. Inferring nothing, as Rails does, was weighed too. It leaves the type unchecked until someone writes the list by hand.

## Consequences

- **A generated enum and a declared one differ only in their defaults.** The schema writes the two keys out, so `schema.ts` shows why a generated enum has no methods, and the clash checks and listed scopes apply once an override turns them on, as for a declared enum.
- **`enum: true` follows the database.** A label a later migration adds gets its methods when the schema is regenerated. A list written in the override doesn't follow it.
- **`enum: false` drops a generated enum**, for an app that wants the column as a plain `string`.
