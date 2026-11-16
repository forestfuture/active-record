import { describe, expectTypeOf, test } from "vite-plus/test";
import { Model } from "../../packages/active-record/src/index.ts";

class Sample extends Model.define({
  id: { type: "integer", null: false },
  quantity: "integer",
  title: { type: "string", null: false },
  createdAt: "datetime",
  status: { type: "string", enum: ["draft", "published"] },
}) {}

describe("grouping types (#345)", () => {
  test("a group's count is keyed by the attribute's value, null included", () => {
    const samples = Sample.none(); // answers without a database

    expectTypeOf(samples.group("title").count()).resolves.toEqualTypeOf<Map<string, number>>();
    expectTypeOf(samples.group("quantity").count()).resolves.toEqualTypeOf<
      Map<number | null, number>
    >();
    const byStatus = () => Sample.group("status").count(); // a static, typed but not run
    expectTypeOf(byStatus).returns.resolves.toEqualTypeOf<
      Map<"draft" | "published" | null, number>
    >();
    // @ts-expect-error -- not an attribute
    samples.group("nope");
  });
});
