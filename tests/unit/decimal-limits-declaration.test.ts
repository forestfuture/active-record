import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import { InvalidModel, Model } from "../../packages/active-record/src/index.ts";
import { connect } from "../../packages/active-record/src/adapters/d1/index.ts";
import { attributeFor } from "../../packages/active-record/src/attribute.ts";

const db = connect({} as never);

/** A Model whose one attribute has `spec`, declared past the types, as plain JavaScript can. */
function withSpec(spec: object) {
  return class Sample extends Model.define({ id: "integer", value: spec as never }) {
    static table = "samples";
  };
}

// A decimal's precision and scale, checked when its Model is first used (#398).
describe("a decimal's precision and scale, declared", () => {
  test("a decimal takes both, and stays text", () => {
    class Price extends Model.define({
      id: "integer",
      amount: { type: "decimal", precision: 10, scale: 2 },
      count: { type: "decimal", precision: 6 },
    }) {}

    expectTypeOf<Price["amount"]>().toEqualTypeOf<string | null>();
    expect(db.model(Price).build({ amount: "1.005", count: "2.5" })).toMatchObject({
      amount: "1.01",
      count: "3",
    });
  });

  test("another type can't have them", () => {
    const typeOnly = () => {
      // @ts-expect-error only a decimal has digits to limit
      Model.define({ n: { type: "integer", scale: 2 } });
      // @ts-expect-error only a decimal has digits to limit
      Model.define({ n: { type: "real", precision: 10 } });
    };
    expect(typeOnly).toBeTypeOf("function");
  });

  test.each([
    [
      { type: "integer", scale: 2 },
      'Sample.value is "integer", so it can\'t have a scale: only a decimal has digits to limit',
    ],
    [{ type: "decimal", scale: -1 }, "Sample.value has a scale -1; use a whole number of digits"],
    [
      { type: "decimal", precision: 2.5 },
      "Sample.value has a precision 2.5; use a whole number of digits",
    ],
    [
      { type: "decimal", precision: 0 },
      "Sample.value has a precision of 0; a precision is 1 to 1000 digits",
    ],
    [
      { type: "decimal", precision: 4, scale: 5 },
      "Sample.value has a scale of 5, past its precision of 4; a scale is at most the precision",
    ],
  ])("%j is an InvalidModel", (spec, message) => {
    expect(() => db.model(withSpec(spec)).build()).toThrow(new InvalidModel(message));
  });
});

// A key copied into a decimal is held, so it's refused past the precision as an assigned
// value is; a condition is only rounded, as no stored value is past the precision (#398).
describe("a decimal key past its precision", () => {
  class Tagged extends Model.define({
    id: "integer",
    ref: { type: "decimal", precision: 3, scale: 0 },
  }) {
    static table = "tagged";
  }

  test("is refused as a key", () => {
    expect(() => attributeFor(Tagged, "ref").key(123456)).toThrow(TypeError);
  });

  test("is rounded as a condition", () => {
    expect(attributeFor(Tagged, "ref").condition("123456.4")).toBe("123456");
  });
});
