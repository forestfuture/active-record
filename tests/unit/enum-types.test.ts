import { describe, expectTypeOf, test } from "vite-plus/test";
import { Model } from "../../packages/active-record/src/index.ts";

class Article extends Model.define({
  id: { type: "integer", null: false },
  status: { type: "string", enum: ["draft", "published"] },
  stage: { type: "string", null: false, enum: ["idea", "done"] },
}) {}

describe("an enum attribute's types (#340)", () => {
  test("its property is the union of its names", () => {
    expectTypeOf<Article["status"]>().toEqualTypeOf<"draft" | "published" | null>();
    expectTypeOf<Article["stage"]>().toEqualTypeOf<"idea" | "done">();
  });
});
