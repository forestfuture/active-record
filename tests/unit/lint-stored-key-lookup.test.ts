import storedKeyLookup from "../../scripts/lint/stored-key-lookup.mjs";
import { ruleTester } from "../support/rule-tester.ts";

// The library's own lookups by a computed key say whether the key is stored, so it isn't normalized again (#354).
ruleTester.run("stored-key-lookup", storedKeyLookup, {
  valid: [
    "relation.where(asStored({ [attribute]: key }));",
    "relation.findBy(asStored({ [attribute]: key }));",
    "relation.whereNot(asStored({ [primaryKey]: key }) as never);",
    // Conditions named in the code are what a caller wrote, normalized as theirs are.
    "relation.where({ email: 'jane@example.com' });",
    "relation.where(conditions);",
    "relation.where(sql`${column(name)} = ${value}`);",
    // Not a Relation method that takes conditions.
    "relation.build({ [attribute]: value });",
    "map.set({ [attribute]: value });",
    "relation[method]({ [attribute]: value });",
  ],
  invalid: [
    {
      name: "a where",
      code: "relation.where({ [attribute]: key });",
      errors: [{ messageId: "storedKeyLookup", data: { method: "where" } }],
    },
    {
      name: "a findBy",
      code: "relation.findBy({ [attribute]: key });",
      errors: [{ messageId: "storedKeyLookup", data: { method: "findBy" } }],
    },
    {
      name: "a whereNot cast to another type",
      code: "relation.whereNot({ [primaryKey]: key } as never);",
      errors: [{ messageId: "storedKeyLookup", data: { method: "whereNot" } }],
    },
    {
      name: "a deleteBy with a named key beside a computed one",
      code: "relation.deleteBy({ kind: 'post', [attribute]: key });",
      errors: [{ messageId: "storedKeyLookup", data: { method: "deleteBy" } }],
    },
    {
      name: "an exists",
      code: "relation.exists({ [attribute]: key });",
      errors: [{ messageId: "storedKeyLookup", data: { method: "exists" } }],
    },
  ],
});
