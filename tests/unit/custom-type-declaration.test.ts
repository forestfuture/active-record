import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import { defineType, InvalidModel, Model } from "../../packages/active-record/src/index.ts";
import { connect } from "../../packages/active-record/src/adapters/d1/index.ts";

// connect() never touches the binding until a query runs, and these tests run none.
const db = connect({} as never);

/** Cents, as a bigint: a type whose value isn't its stored type's. */
const cents = defineType({
  storedAs: "integer",
  cast: (input: unknown) => BigInt(input as number),
  serialize: (value) => Number(value),
  deserialize: (stored) => BigInt(stored),
});

/** A Model whose one attribute has `spec`, past the types, as plain JavaScript could declare it. */
const withSpec = (spec: unknown) =>
  class Sample extends Model.define({ id: "integer", value: spec as never }) {
    static override table = "samples";
  };

describe("a custom type's declaration (#20)", () => {
  test("its values are typed as its own, nullable unless null: false", () => {
    class Sample extends Model.define({
      id: { type: "integer", null: false },
      plain: cents,
      written: { type: cents },
      required: { type: cents, null: false, default: () => 0n },
    }) {}
    expectTypeOf<Sample["plain"]>().toEqualTypeOf<bigint | null>();
    expectTypeOf<Sample["written"]>().toEqualTypeOf<bigint | null>();
    expectTypeOf<Sample["required"]>().toEqualTypeOf<bigint>();
  });

  test("an enum, a storage or a generated id with one is a compile error", () => {
    // @ts-expect-error a custom type has no enum
    Model.define({ value: { type: cents, enum: { low: 0 } } });
    // @ts-expect-error nor a storage
    Model.define({ value: { type: cents, storage: "unixSeconds" } });
    // @ts-expect-error nor a generated id
    Model.define({ value: { type: cents, generateId: true } });
  });

  test.each([
    [
      { type: cents, enum: { low: 0 } },
      "Sample.value is a custom type, so it can't have an enum: an enum is stored as text or integers",
    ],
    [
      { type: cents, storage: "unixSeconds" },
      "Sample.value is a custom type, so it can't have a storage: only a datetime is stored as an epoch",
    ],
    [
      { type: cents, generateId: true },
      "Sample.value is a custom type, so it can't have generateId: generated ids are strings",
    ],
  ])("%j is an InvalidModel, past the types", (spec, message) => {
    expect(() => db.model(withSpec(spec)).build()).toThrow(new InvalidModel(message));
  });

  test("an object defineType didn't make isn't a type", () => {
    const lookalike = { storedAs: "integer", cast: Number, serialize: Number, deserialize: Number };

    expect(() => db.model(withSpec({ type: lookalike })).build()).toThrow(
      new InvalidModel(
        'Sample.value has type {"storedAs":"integer"}; use a type\'s name ("string", "integer", "real", "decimal", "boolean", "datetime", "date", "json", "binary"), or a type defineType made',
      ),
    );
  });

  const parts = { cast: Number, serialize: Number, deserialize: Number };

  test("defineType refuses a storedAs that isn't a built-in type's name", () => {
    expect(() => defineType({ ...parts, storedAs: "text" } as never)).toThrow(
      new TypeError(
        'defineType: storedAs "text" isn\'t a type\'s name; use "string", "integer", "real", "decimal", "boolean", "datetime", "date", "json", or "binary"',
      ),
    );
  });

  test("defineType refuses a type without one of its functions", () => {
    expect(() => defineType({ ...parts, storedAs: "integer", cast: undefined } as never)).toThrow(
      new TypeError("defineType: cast isn't a function"),
    );
  });
});
