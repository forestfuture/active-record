import fc from "fast-check";
import { describe, expect, test } from "vite-plus/test";
import { define, type SpecObject } from "../../packages/active-record/src/metadata.ts";
import {
  applyOverride,
  copiedKeys,
  isSpecOverride,
  overridableKeyNames,
  specProblem,
} from "../../packages/active-record/src/spec-keys.ts";
import { PURE_RUNS } from "../support/properties.ts";
import { values } from "../support/values.ts";

// The rules for each key of an attribute's spec (#164): what a change keeps, drops and replaces,
// and what a spec can't be, stated for any spec and any change.
const initial = () => 1;
const optional = <T>(arbitrary: fc.Arbitrary<T>) => fc.option(arbitrary, { nil: undefined });
const type = fc.constantFrom("string", "integer", "real", "boolean", "datetime", "json");
const storage = fc.constantFrom("unixSeconds", "unixMilliseconds");

const spec = fc.record(
  {
    type,
    null: fc.boolean(),
    column: fc.constant("col"),
    default: optional(fc.constant(initial)),
    generateId: optional(fc.boolean()),
    storage: optional(storage),
  },
  { requiredKeys: ["type"] },
) as fc.Arbitrary<SpecObject>;

const change = fc.record(
  {
    type: optional(type),
    null: optional(fc.boolean()),
    default: optional(fc.constant(initial)),
    generateId: optional(fc.boolean()),
    storage: optional(storage),
  },
  { requiredKeys: [] },
);

/** Whether JSON writes the value, as an error message shows it. */
function isJson(value: unknown): boolean {
  try {
    return JSON.stringify(value) !== undefined;
  } catch {
    return false;
  }
}

describe("applying a change to a spec", () => {
  test("gives every key the change gives, and keeps the column", () => {
    fc.assert(
      fc.property(spec, change, (base, given) => {
        const applied = applyOverride(base, given);

        for (const [key, value] of Object.entries(given)) {
          if (value !== undefined) expect(applied[key as keyof SpecObject]).toBe(value);
        }
        expect(applied.column).toBe(base.column);
      }),
      PURE_RUNS,
    );
  });

  test("on a new type keeps nullability, and drops what was written for the old type", () => {
    fc.assert(
      fc.property(spec, change, (base, given) => {
        fc.pre(given.type !== undefined && given.type !== base.type);

        const applied = applyOverride(base, given);

        expect(applied.null).toBe(given.null ?? base.null);
        expect(applied.default).toBe(given.default);
        expect(applied.generateId).toBe(given.generateId);
        expect(applied.storage).toBe(given.storage);
      }),
      PURE_RUNS,
    );
  });

  test("on the same type leaves untouched what the change doesn't mention", () => {
    fc.assert(
      fc.property(spec, (base) => {
        expect(applyOverride(base, {})).toEqual(base);
        expect(applyOverride(base, { type: base.type })).toEqual(base);
      }),
      PURE_RUNS,
    );
  });

  test("a default replaces a generated id, and a generated id replaces a default", () => {
    const generated = { type: "string", generateId: true } as const;
    const defaulted = { type: "string", default: initial } as const;

    expect(applyOverride(generated, { default: initial })).toEqual({
      type: "string",
      default: initial,
    });
    expect(applyOverride(defaulted, { generateId: true })).toEqual(generated);
  });

  test("`generateId: false` replaces nothing, and `storage` replaces nothing", () => {
    const base = { type: "string", default: initial } as const;

    expect(applyOverride(base, { generateId: false })).toEqual({ ...base, generateId: false });
    expect(applyOverride({ type: "datetime", storage: "unixSeconds" }, { null: false })).toEqual({
      type: "datetime",
      storage: "unixSeconds",
      null: false,
    });
  });
});

describe("a spec's problems", () => {
  test("refuses a generated id on a non-string, a storage on a non-datetime, and both a default and a generated id", () => {
    fc.assert(
      fc.property(spec, (given) => {
        const problem = specProblem("T.a", given);

        const bothGiven = given.generateId === true && given.default !== undefined;
        const generatedNonString = given.generateId === true && given.type !== "string";
        const storedNonDatetime = given.storage !== undefined && given.type !== "datetime";
        expect(problem !== undefined).toBe(bothGiven || generatedNonString || storedNonDatetime);
        if (problem !== undefined) expect(problem.startsWith("T.a ")).toBe(true);
      }),
      PURE_RUNS,
    );
  });

  test("refuses a storage that isn't an epoch unit, naming the units", () => {
    fc.assert(
      fc.property(
        values.filter((value) => value !== undefined && value !== "unixSeconds"),
        fc.constantFrom("datetime", "string"),
        (stored, kind) => {
          fc.pre(stored !== "unixMilliseconds" && isJson(stored));

          const problem = specProblem("T.a", { type: kind, storage: stored as never });

          expect(problem).toBe(
            `T.a has storage ${JSON.stringify(stored)}; use "unixSeconds" or "unixMilliseconds"`,
          );
        },
      ),
      PURE_RUNS,
    );
  });

  test("a generated id that isn't `true` is not given, so it has no problem", () => {
    expect(specProblem("T.a", { type: "integer", generateId: false })).toBeUndefined();
    expect(specProblem("T.a", { type: "integer", generateId: "yes" as never })).toBeUndefined();
  });

  test("names the generated id first when it's given with a default", () => {
    expect(specProblem("T.a", { type: "string", generateId: true, default: initial })).toBe(
      "T.a has both generateId and a default; keep one",
    );
  });
});

describe("an override's shape", () => {
  const keyed = fc.constantFrom("type", "null", "default", "generateId", "storage");

  test("refuses anything that isn't an object, and any key that isn't a spec key but the column", () => {
    fc.assert(
      fc.property(values, (value) => {
        if (isSpecOverride(value)) expect(typeof value === "object" && value !== null).toBe(true);
      }),
      PURE_RUNS,
    );
    expect(isSpecOverride({ column: "c" })).toBe(false);
    expect(isSpecOverride({ extra: 1 })).toBe(false);
    expect(isSpecOverride([])).toBe(false);
    expect(isSpecOverride(JSON.parse('{"__proto__": 1}'))).toBe(false);
  });

  test("refuses a key holding the wrong kind of value, and accepts it left undefined", () => {
    fc.assert(
      fc.property(keyed, (key) => {
        expect(isSpecOverride({ [key]: undefined })).toBe(true);
        expect(isSpecOverride({ [key]: Symbol("nope") })).toBe(false);
      }),
      PURE_RUNS,
    );
  });
});

describe("a spec's keys", () => {
  test("every key of a spec but its column has a rule an override can use", () => {
    const expected = {
      type: true,
      null: true,
      column: true,
      default: true,
      generateId: true,
      storage: true,
    } satisfies Record<keyof SpecObject, true>;

    expect(overridableKeyNames.split(", ")).toEqual(
      Object.keys(expected).filter((key) => key !== "column"),
    );
  });

  test("a definition carries the keys a spec gives, and the column's default", () => {
    fc.assert(
      fc.property(spec, (given) => {
        const { column: _column, ...rest } = given;
        const definition = define("fooBar", rest as never);

        expect(definition.column).toBe("foo_bar");
        expect(definition.type).toBe(given.type);
        expect(definition.default).toBe(given.default);
        expect(definition.generateId).toBe(given.generateId === true ? true : undefined);
        expect(definition.storage).toBe(given.storage);
        expect(
          Object.keys(definition).every(
            (key) => key in copiedKeys(given) || key === "type" || key === "column",
          ),
        ).toBe(true);
      }),
      PURE_RUNS,
    );
  });
});
