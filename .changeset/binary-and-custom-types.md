---
"@forestfuture/active-record": minor
---

`binary` attributes and custom types (#20).

A `binary` attribute holds bytes as a `Uint8Array`, in a `BLOB` column on D1 or a `bytea` one on Postgres. It's assigned a `Uint8Array` or an `ArrayBuffer`, and always reads back as a plain `Uint8Array`. A change is found by comparing bytes, so a byte changed in place is saved. `where`, `gt` and `order` compare bytes in order. A printed record shows `<3 bytes of binary data>`. `active-record schema` reads `BLOB` and `bytea` columns as `binary`, where they were errors, and `g` writes `name:binary` as `BLOB` or `BYTEA`. `permit` still refuses a file: assign `new Uint8Array(await file.arrayBuffer())`.

`defineType({ storedAs, cast, serialize, deserialize })` makes a custom type, which a spec takes as it takes a type's name: `price: money`, or `{ type: money, null: false }`, and a generated Model's override too. Its values are kept as `storedAs` keeps its own, so they're read strictly, compared and ordered as that type's are. What its `cast` or `deserialize` throws is a `TypeError` naming the Model and attribute, with the type's error as its `cause`.

Breaking: `typeForAttribute(name).serialize` is typed `string | number | Uint8Array | null`, since a `binary` attribute's stored form is bytes.
