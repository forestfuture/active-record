# A polymorphic association lists its Models and stores their modelName

A polymorphic belongsTo (#60) is declared with the Models it can point at: `commentable = belongsTo([Post, Photo])`. Its record holds a type attribute (`commentableType`) and a foreign key (`commentableId`). The type holds the `modelName` of the Model whose table the record is in, so `class FeaturedPost extends Post {}` is stored as `"Post"`. Each listed Model's side is `hasMany(Remark, { as: "commentable" })` or `hasOne`.

Rails declares `belongs_to :commentable, polymorphic: true` with no list. It stores the base class's name and finds the class from it with `constantize` when the record is read. We list the Models because nothing can find a class from a name here: there's no constant lookup, and a registry of every Model by name would be module-level state that the class declarations don't otherwise need. The list also types the accessor: `await remark.commentable()` is `Post | Photo | null`, and `set` refuses any other Model at compile time.

We store the `modelName` because the class name isn't stable: a bundler that renames classes would store `e`, and rows written by one build couldn't be read by the next. A Model sets `static modelName` to keep it fixed, as it does for its table and its inferred foreign keys. Storing the table name was weighed. It's stable too, but Rails apps store class names, so a database shared with one, or moved from one, already holds them.

## Consequences

- **The stored values are data.** Renaming a listed Model, or its `modelName`, leaves rows naming the old one. Reading one throws `UnknownModelName`, naming the value and the listed Models, as Rails raises when it can't find the class. Changing the name takes a data migration.
- **Two listed Models can't store the same name.** A Model and its subclass both store the parent's name, so listing both is an `InvalidModel`.
- **A Model added to the app isn't reachable until it's listed.** Its `hasMany` with `as` writes its name, so declaring it against a belongsTo that doesn't list it is an `InvalidModel`.
- **Which Model to build isn't known**, so the polymorphic side has no `build` or `create`, as in Rails.
- **Preloading knows every Model up front**, so it plans one statement per listed Model with the owners' query, in its round trip. Each statement runs the owners' query again, even for a Model no record points at.
- **No foreign key can be enforced**: the key points at a different table per row, so neither D1 nor Postgres can check it.
