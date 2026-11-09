import { describe, expect, test } from "vite-plus/test";
import { column, Model, sql } from "../../packages/active-record/src/index.ts";
import { connect } from "../../packages/active-record/src/adapters/d1/index.ts";
import { attributeFor } from "../../packages/active-record/src/attribute.ts";

class Sample extends Model.define({
  id: { type: "integer", null: false },
  label: "string",
  stamp: { type: "datetime", storage: "unixSeconds" },
}) {
  static table = "samples";
}

// No D1 needed: assigning casts and never queries (#163).
const samples = connect({} as never).model(Sample);
const refused = new TypeError(`Sample: got undefined for "label"; use null to store NULL`);

describe("undefined is refused with one message wherever a value is assigned", () => {
  test("by build", () => {
    expect(() => samples.build({ label: undefined as never })).toThrow(refused);
  });

  test("by assign", () => {
    expect(() => samples.build().assign({ label: undefined as never })).toThrow(refused);
  });

  test("by a property setter", () => {
    expect(() => {
      samples.build().label = undefined as never;
    }).toThrow(refused);
  });

  test("by permit", () => {
    expect(() => Sample.permit({ label: undefined }, "label")).toThrow(refused);
  });

  test("by a typed value in a fragment", () => {
    const label = column("label");

    expect(() => samples.where(sql`${label} = ${label.value(undefined)}`)).toThrow(refused);
  });

  test("by a key copied from another record", () => {
    expect(() => attributeFor(Sample, "label").key(undefined, "owner")).toThrow(refused);
  });
});
