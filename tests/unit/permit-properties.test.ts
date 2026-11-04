import fc from "fast-check";
import { describe, expect, test } from "vite-plus/test";
import { connect } from "../../packages/d1-record/src/index.ts";
import { User } from "../fixtures/models/user.ts";
import { objectKeys } from "../support/json-values.ts";
import { PURE_RUNS } from "../support/properties.ts";

type Name = "email" | "role" | "isActive" | "age";
const attributeNames: Name[] = ["email", "role", "isActive", "age"];

// No D1 needed: building a record casts what's assigned and never queries.
const users = connect({} as never).model(User);

// A request body as JSON gives it: any keys, including the ones that mean something to an
// object (`__proto__`, `constructor`), as own properties (JSON.parse makes them so), and values
// of any JSON shape (#82, #122).
const keys = fc.oneof(fc.constantFrom(...attributeNames, "id", "token", "isAdmin"), objectKeys);
const bodies = fc
  .array(fc.tuple(keys, fc.jsonValue()), { maxLength: 8 })
  .map((entries) => Object.fromEntries(entries));

// The attributes a controller names: some of them, in any order.
const named = fc.subarray(attributeNames, { minLength: 1 });

const runs = PURE_RUNS;

/** What assigning `value` to `name` gives, or that it was refused (the same cast permit uses). */
function assigned(name: Name, value: unknown): { value: unknown } | "refused" {
  try {
    return { value: users.build({ [name]: value as never })[name] };
  } catch {
    return "refused";
  }
}

/** `permit`'s result, or that it was refused. */
function permitted(body: object, names: Name[]): Record<string, unknown> | "refused" {
  try {
    return User.permit(body, ...names) as Record<string, unknown>;
  } catch (error) {
    expect(error).toBeInstanceOf(TypeError);
    return "refused";
  }
}

describe("Model.permit, for any request body", () => {
  test("is refused exactly when assigning one of the named values it has would be", () => {
    fc.assert(
      fc.property(bodies, named, (body, names) => {
        const own = names.filter((name) => Object.hasOwn(body, name));
        const wouldRefuse = own.some((name) => assigned(name, body[name]) === "refused");

        expect(permitted(body, names) === "refused").toBe(wouldRefuse);
      }),
      runs,
    );
  });

  test("returns exactly the named attributes the body has as its own keys, cast as assigned", () => {
    fc.assert(
      fc.property(bodies, named, (body, names) => {
        const result = permitted(body, names);
        fc.pre(result !== "refused");

        const own = names.filter((name) => Object.hasOwn(body, name));
        expect(Object.keys(result as object).sort()).toEqual([...own].sort());
        for (const name of own) {
          expect((result as Record<string, unknown>)[name]).toEqual(
            (assigned(name, body[name]) as { value: unknown }).value,
          );
        }
      }),
      runs,
    );
  });

  test("returns a plain object, whatever the body's keys", () => {
    fc.assert(
      fc.property(bodies, named, (body, names) => {
        const result = permitted(body, names);
        fc.pre(result !== "refused");

        expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
      }),
      runs,
    );
  });

  // A plain object has no inherited keys unless Object.prototype was polluted elsewhere in the
  // app. permit reads own keys only, so even then a name it wasn't given stays out (#82).
  test("reads own keys only, even when Object.prototype carries an attribute's name", () => {
    Object.defineProperty(Object.prototype, "role", {
      value: "admin",
      writable: true,
      enumerable: true,
      configurable: true,
    });
    try {
      expect(User.permit({ email: "ada@example.com" }, "email", "role")).toEqual({
        email: "ada@example.com",
      });
    } finally {
      delete (Object.prototype as Record<string, unknown>).role;
    }
  });

  test("takes a form's or query string's keys, a repeated key taking its last value", () => {
    const pairs = fc.array(fc.tuple(keys, fc.string({ maxLength: 12 })), { maxLength: 8 });

    fc.assert(
      fc.property(pairs, named, (entries, names) => {
        const query = new URLSearchParams(entries);
        let permitted: Record<string, unknown>;
        try {
          permitted = User.permit(query, ...names) as Record<string, unknown>;
        } catch (error) {
          expect(error).toBeInstanceOf(TypeError);
          return;
        }

        expect(Object.keys(permitted).every((key) => names.includes(key as Name))).toBe(true);
        if ("email" in permitted) {
          expect(permitted.email).toBe(query.getAll("email").at(-1));
        }
      }),
      runs,
    );
  });

  test("refuses input that isn't a plain object, FormData or URLSearchParams", () => {
    // Class instances, arrays, maps, dates and objects with another prototype: their keys, and
    // the ones their prototypes carry, are never read.
    const notPlain = fc.oneof(
      fc.anything({ withMap: true, withSet: true, withDate: true, withTypedArray: true }),
      fc.dictionary(fc.constantFrom(...attributeNames), fc.string()).map((own) => {
        return Object.assign(Object.create({ role: "admin", email: "x" }), own) as object;
      }),
    );
    const isPlain = (input: unknown) =>
      typeof input === "object" &&
      input !== null &&
      [Object.prototype, null].includes(Object.getPrototypeOf(input));

    fc.assert(
      fc.property(
        notPlain.filter((input) => !isPlain(input)),
        named,
        (input, names) => {
          expect(() => User.permit(input as never, ...names)).toThrow(TypeError);
        },
      ),
      runs,
    );
  });
});
