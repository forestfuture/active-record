import fc from "fast-check";
import { describe, expect, test } from "vite-plus/test";
import { UnknownAssociation, UnknownAttribute } from "../../packages/active-record/src/index.ts";
import { connect } from "../../packages/d1-record/src/index.ts";
import { users as userAttributes } from "../fixtures/DB.ts";
import { User } from "../fixtures/models/user.ts";
import { PURE_RUNS } from "../support/properties.ts";

// No D1 needed: these calls check their names before they query.
const users = connect({} as never).model(User);
const user = users.build({ id: 1, email: "ada@example.com" });

// The fixture User's attributes and associations.
const own = new Set([...Object.keys(userAttributes), "posts", "profile"]);

// Names an app might take from a URL (`?include=`, `?sort=`) or a JSON body: every member that
// objects, functions and arrays inherit, and any other text. None is one of the Model's own
// (#84, #122).
const inheritedNames = [
  ...Object.getOwnPropertyNames(Object.prototype),
  ...Object.getOwnPropertyNames(Function.prototype),
  ...Object.getOwnPropertyNames(Array.prototype),
  "prototype",
];
const names = fc
  .oneof(fc.constantFrom(...inheritedNames), fc.string({ maxLength: 16 }))
  .filter((name) => !own.has(name));

const runs = PURE_RUNS;

/** A JSON body's key, which may be an own "__proto__". */
const keyed = (name: string) => JSON.parse(`{${JSON.stringify(name)}: 1}`) as never;

// One property per call, so a counterexample names the call that accepted the name.
const associationCalls: [string, (name: string) => unknown][] = [
  ["includes(name)", (name) => users.includes(name as never)],
  ["includes({ [name]: ... })", (name) => users.includes({ [name]: "posts" } as never)],
  ["includes({ posts: name })", (name) => users.includes({ posts: name } as never)],
  ["loaded(name)", (name) => user.loaded(name as never)],
  ["isLoaded(name)", (name) => user.isLoaded(name as never)],
];

const attributeCalls: [string, (name: string) => unknown][] = [
  ["attributeWas(name)", (name) => user.attributeWas(name as never)],
  ["isAttributeChanged(name)", (name) => user.isAttributeChanged(name as never)],
  ["restoreAttributes([name])", (name) => user.restoreAttributes([name as never])],
  ["select(name)", (name) => users.select(name as never)],
  ["order({ [name]: 'asc' })", (name) => users.order({ [name]: "asc" } as never)],
  ["where({ [name]: 1 }), as a JSON body", (name) => users.where(keyed(name))],
  ["build({ [name]: 1 }), as a JSON body", (name) => users.build(keyed(name))],
  ["assign({ [name]: 1 }), as a JSON body", (name) => user.assign(keyed(name))],
  ["permit({}, name)", (name) => User.permit({}, name as never)],
];

describe("a name that isn't the Model's own, of any kind", () => {
  test.each(associationCalls)("%s is UnknownAssociation", (_label, call) => {
    fc.assert(
      fc.property(names, (name) => {
        expect(() => call(name)).toThrow(UnknownAssociation);
      }),
      runs,
    );
  });

  test.each(attributeCalls)("%s is UnknownAttribute", (_label, call) => {
    fc.assert(
      fc.property(names, (name) => {
        expect(() => call(name)).toThrow(UnknownAttribute);
      }),
      runs,
    );
  });
});
