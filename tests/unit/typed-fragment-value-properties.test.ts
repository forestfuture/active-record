import fc from "fast-check";
import { describe, expect, test } from "vite-plus/test";
import { column, Model, sql } from "../../packages/active-record/src/index.ts";
import { connect } from "../../packages/active-record/src/adapters/d1/index.ts";
import { PURE_RUNS } from "../support/properties.ts";
import { values } from "../support/values.ts";

// A typed value in a fragment comes from outside (JSON, a form, a query string), so for a value
// of any shape it's one bound parameter in the attribute's stored form, or a TypeError that names
// the attribute, and it never changes the SQL text (#142).
const declared = {
  label: "string",
  quantity: "integer",
  ratio: "real",
  enabled: "boolean",
  stamp: "datetime",
  seconds: { type: "datetime", storage: "unixSeconds" },
  settings: "json",
} as const;

class Sample extends Model.define({ id: { type: "integer", null: false }, ...declared }) {
  static table = "samples";
}

// No D1 needed: compiling a Relation never queries.
const samples = connect({} as never).model(Sample);
const attributes = Object.keys(declared) as (keyof typeof declared)[];

/** The fragment `attribute = value`, compiled, or what it threw. */
function compiled(attribute: string, value: unknown) {
  const reference = column(attribute);
  try {
    return { result: samples.where(sql`${reference} = ${reference.value(value)}`).toSql() };
  } catch (error) {
    return { error };
  }
}

describe("a typed value of any shape in a fragment", () => {
  test("is one bound parameter, or a TypeError that names the attribute", () => {
    fc.assert(
      fc.property(fc.constantFrom(...attributes), values, (attribute, value) => {
        const outcome = compiled(attribute, value);

        if ("error" in outcome) {
          expect(outcome.error).toBeInstanceOf(TypeError);
          expect((outcome.error as TypeError).message).toMatch(new RegExp(`for "${attribute}"`));
          return;
        }
        const { params } = outcome.result;
        expect(params).toHaveLength(1);
        const [param] = params;
        expect(param === null || ["string", "number"].includes(typeof param)).toBe(true);
      }),
      PURE_RUNS,
    );
  });

  test("never changes the SQL text", () => {
    fc.assert(
      fc.property(fc.constantFrom(...attributes), values, (attribute, value) => {
        const outcome = compiled(attribute, value);
        const fixed = compiled(attribute, null);

        if ("error" in outcome || "error" in fixed) return;
        expect(outcome.result.sql).toBe(fixed.result.sql);
      }),
      PURE_RUNS,
    );
  });
});
