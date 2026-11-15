# A custom type is stored as a built-in type

A custom type (#20) is made with `defineType({ storedAs, cast, serialize, deserialize })` and given to a spec as the object itself: `price: money`, or `{ type: money, null: false }`. Its values are kept as its `storedAs` type keeps its own. Writing a value runs `serialize`, casts what it gives as the stored type's value, then writes that as the stored type does. Reading a cell reads it strictly as the stored type (#159), then runs `deserialize`.

Rails gives a type its own `cast`, `serialize` and `deserialize` over the database's raw values, and registers it by name (`ActiveRecord::Type.register(:money, MoneyType)`), so a Model writes `attribute :price, :money`. We pass the object, because TypeScript infers the attribute's property type from it, and a registry by name would be module-level state that a string can't type. We layer the type on a built-in one, because the core already does what each database needs for the built-in types: Postgres's type parsers, D1's lists and bulk rows bound as JSON, strict reads, the comparisons that may run on a type, and change tracking by stored form. A type that handled raw cells would need all of that, for every adapter, written again.

Raw cells were weighed: they'd let a type store a form no built-in type has. Every form an app needs is one the built-ins write (text, an integer, a real, bytes, JSON), so the cost buys nothing yet.

## Consequences

- **A custom type compares and orders as its stored type does.** Money stored as integer cents orders by amount. A type stored as `boolean` or `json` can't be compared, as those types can't.
- **Its refusals are the core's.** Whatever its `cast` or `deserialize` throws becomes a `TypeError` naming the Model and attribute, with the type's error as its `cause` (left off for a filtered attribute, since it may show the value). A condition holding a value it can't cast matches nothing.
- **A generated Model takes one through an override**, since SQL can't say a column holds money. Like any change of type, it drops the generated default.
- **Only an object `defineType` made is a type.** A lookalike is an `InvalidModel`, so a spec's type is always one whose functions were checked when it was made.
