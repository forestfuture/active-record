import { describe, expectTypeOf, test } from "vite-plus/test";
import { defineType, Model, sql } from "../../packages/active-record/src/index.ts";

/** Cents, kept as an integer. */
const cents = defineType({
  storedAs: "integer",
  cast: (input) => input as bigint,
  serialize: (value) => Number(value),
  deserialize: (stored) => BigInt(stored),
});

/** A list of tags, kept as text. */
const tags = defineType({
  storedAs: "string",
  cast: (input) => input as string[],
  serialize: (value) => value.join(","),
  deserialize: (stored) => stored.split(","),
});

class Sample extends Model.define({
  id: { type: "integer", null: false },
  quantity: "integer",
  ratio: "real",
  amount: { type: "decimal", null: false },
  title: "string",
  enabled: "boolean",
  createdAt: "datetime",
  bookedOn: "date",
  settings: "json",
  data: "binary",
  status: { type: "string", enum: ["draft", "published"] },
  priority: { type: "integer", enum: { low: 0, high: 10 } },
  price: cents,
  labels: tags,
}) {}

describe("calculation types (#344)", () => {
  test("sum and average take number attributes, and a sum is the attribute's value", () => {
    const samples = Sample.all();

    expectTypeOf(samples.sum("quantity")).resolves.toEqualTypeOf<number>();
    expectTypeOf(samples.sum("amount")).resolves.toEqualTypeOf<string>();
    expectTypeOf(samples.sum("price")).resolves.toEqualTypeOf<bigint>();
    expectTypeOf(samples.sum(sql`quantity * 2`)).resolves.toEqualTypeOf<number>();
    expectTypeOf(samples.average("ratio")).resolves.toEqualTypeOf<number | null>();
    // Checked by the type checker only; never called.
    const typeOnly = () => {
      // @ts-expect-error text can't be added up
      void samples.sum("title");
      // @ts-expect-error nor can an enum, though it's stored as an integer
      void samples.sum("priority");
      // @ts-expect-error nor a custom type stored as text
      void samples.average("labels");
      // @ts-expect-error nor a datetime
      void samples.average("createdAt");
      // @ts-expect-error an attribute the Model doesn't have
      void samples.sum("missing");
    };
    expectTypeOf(typeOnly).toBeFunction();
  });

  test("minimum and maximum take ordered attributes, and are the attribute's value or null", () => {
    const samples = Sample.all();

    expectTypeOf(samples.minimum("createdAt")).resolves.toEqualTypeOf<Date | null>();
    expectTypeOf(samples.maximum("amount")).resolves.toEqualTypeOf<string | null>();
    expectTypeOf(samples.maximum("status")).resolves.toEqualTypeOf<"draft" | "published" | null>();
    expectTypeOf(samples.minimum("price")).resolves.toEqualTypeOf<bigint | null>();
    expectTypeOf(samples.maximum(sql`length(title)`)).resolves.toEqualTypeOf<unknown>();
    const typeOnly = () => {
      void samples.minimum("bookedOn");
      void samples.maximum("labels");
      // @ts-expect-error booleans aren't ordered
      void samples.minimum("enabled");
      // @ts-expect-error nor is json
      void samples.maximum("settings");
      // @ts-expect-error nor are bytes, which Postgres has no minimum of
      void samples.maximum("data");
    };
    expectTypeOf(typeOnly).toBeFunction();
  });
});
