import fc from "fast-check";
import { runInThisContext } from "node:vm";
import { describe, expect, test } from "vite-plus/test";
import { renderSchema } from "../../cli/schema/render.ts";
import { schemaOf } from "../../cli/schema/schema.ts";
import { jsonValues } from "../support/json-values.ts";
import { PURE_RUNS } from "../support/properties.ts";

/** The generated schema.ts's tables as a value: its `export`s and `as const`s dropped, then run. */
function generated(source: string): Record<string, { attributes: Record<string, unknown> }> {
  const code = source
    .replace(/^import .*$/gm, "")
    .replace(/^export const /gm, "const ")
    .replace(/ as const;/g, ";");
  // `d1({ binding })` is the adapter's; the tables don't depend on it.
  return runInThisContext(
    `(() => {\nconst d1 = (x) => x;\n${code}\nreturn schema.tables;\n})()`,
  ) as never;
}

/** The `default` of a JSON column that a migration declares with `value` as its default. */
function defaultOf(value: unknown): unknown {
  const text = JSON.stringify(value).replaceAll("'", "''");
  const sql = `CREATE TABLE things (
    id INTEGER PRIMARY KEY,
    settings TEXT CHECK (json_valid(settings)) DEFAULT '${text}'
  );`;
  const result = schemaOf([{ name: "0001_create.sql", sql }]);
  if (!result.ok) throw new Error(result.errors.join("\n"));
  const settings = generated(
    renderSchema({ tables: result.tables, binding: "DB", models: [] }, "migrations/"),
  ).things!.attributes.settings as { default: () => unknown };
  return settings.default();
}

// A column's JSON default is data the generator copies into source: whatever it holds, the
// generated default must be that value, key for key (#119, #122).
describe("a JSON column's default, in the generated schema", () => {
  test("is the value the migration declared, key for key", () => {
    fc.assert(
      fc.property(jsonValues, (value) => {
        // JSON text compares key order and every own key; `toEqual` would forgive a prototype.
        expect(JSON.stringify(defaultOf(value))).toBe(JSON.stringify(value));
      }),
      PURE_RUNS,
    );
  });

  test("keeps a __proto__ key as a key, not as the object's prototype (#119)", () => {
    const value = JSON.parse('{"__proto__":{"a":1},"b":2}') as object;
    const result = defaultOf(value) as Record<string, unknown>;

    expect(Object.keys(result).sort()).toEqual(["__proto__", "b"]);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  });
});
