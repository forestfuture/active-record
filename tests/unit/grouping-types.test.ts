import { describe, expectTypeOf, test } from "vite-plus/test";
import { Model, sql } from "../../packages/active-record/src/index.ts";

class Sample extends Model.define({
  id: { type: "integer", null: false },
  quantity: "integer",
  title: { type: "string", null: false },
  createdAt: "datetime",
  status: { type: "string", enum: ["draft", "published"] },
  settings: "json",
}) {}

describe("grouping types (#345)", () => {
  test("a group's count is keyed by the attribute's value, null included", () => {
    const samples = Sample.none(); // answers without a database

    expectTypeOf(samples.group("title").count()).resolves.toEqualTypeOf<Map<string, number>>();
    expectTypeOf(samples.group("quantity").count()).resolves.toEqualTypeOf<
      Map<number | null, number>
    >();
    const byStatus = () => Sample.group("status").count(); // a static: typed, never called
    expectTypeOf(byStatus).returns.resolves.toEqualTypeOf<
      Map<"draft" | "published" | null, number>
    >();
    expectTypeOf(samples.group("title", "createdAt").count()).resolves.toEqualTypeOf<
      Map<[string, Date | null], number>
    >();
    expectTypeOf(
      samples.group("title").where({ quantity: 1 }).group("createdAt").count(),
    ).resolves.toEqualTypeOf<Map<[string, Date | null], number>>();
    expectTypeOf(samples.group(sql`1`, "title").count()).resolves.toEqualTypeOf<
      Map<[unknown, string], number>
    >();
    // Checked by the type checker only; never called.
    const typeOnly = () => {
      // @ts-expect-error -- not an attribute
      void samples.group("nope");
      // @ts-expect-error -- Postgres can't compare json
      void samples.group("settings");
    };
    expectTypeOf(typeOnly).toBeFunction();
  });

  test("each calculation's results are typed as on a Relation", () => {
    const byTitle = Sample.none().group("title");

    expectTypeOf(byTitle.sum("quantity")).resolves.toEqualTypeOf<Map<string, number>>();
    expectTypeOf(byTitle.average("quantity")).resolves.toEqualTypeOf<Map<string, number | null>>();
    expectTypeOf(byTitle.maximum("createdAt")).resolves.toEqualTypeOf<Map<string, Date | null>>();
    expectTypeOf(byTitle.minimum(sql`1`)).resolves.toEqualTypeOf<Map<string, unknown>>();
    expectTypeOf(byTitle.calculate("sum", "quantity")).resolves.toEqualTypeOf<
      Map<string, number>
    >();
    // Checked by the type checker only; never called.
    const typeOnly = () => {
      // @ts-expect-error -- text can't be summed
      void byTitle.sum("title");
    };
    expectTypeOf(typeOnly).toBeFunction();
  });

  test("having needs a group, and a grouped Relation has no records", () => {
    const samples = Sample.none();

    expectTypeOf(samples).not.toHaveProperty("having");
    expectTypeOf(samples.group("title")).toHaveProperty("having");
    expectTypeOf(samples.group("title")).not.toHaveProperty("toArray");
    expectTypeOf(samples.group("title")).not.toHaveProperty("first");
  });
});
