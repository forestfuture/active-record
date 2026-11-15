import { describe, expectTypeOf, test } from "vite-plus/test";
import { Model } from "../../packages/active-record/src/index.ts";

class Article extends Model.define({
  id: { type: "integer", null: false },
  status: { type: "string", enum: ["draft", "published"] },
  stage: { type: "string", null: false, enum: ["idea", "done"] },
  priority: { type: "integer", enum: { low: 0, high: 10 } },
  code: { type: "string", enum: { draft: "d", published: "p" } },
}) {}

describe("an enum attribute's types (#340)", () => {
  test("its property is the union of its names", () => {
    expectTypeOf<Article["status"]>().toEqualTypeOf<"draft" | "published" | null>();
    expectTypeOf<Article["stage"]>().toEqualTypeOf<"idea" | "done">();
    expectTypeOf<Article["priority"]>().toEqualTypeOf<"low" | "high" | null>();
    expectTypeOf<Article["code"]>().toEqualTypeOf<"draft" | "published" | null>();
  });

  test("an enum is a string's or an integer's, stored as that type", () => {
    Model.define({
      // @ts-expect-error a list of names is stored as text, so only a string has one
      priority: { type: "integer", enum: ["low", "high"] },
    });
    Model.define({
      // @ts-expect-error an integer enum stores integers
      priority: { type: "integer", enum: { low: "l" } },
    });
    Model.define({
      // @ts-expect-error a string enum stores text
      status: { type: "string", enum: { draft: 0 } },
    });
    Model.define({
      // @ts-expect-error only a string or an integer is an enum
      flag: { type: "boolean", enum: { on: 1 } },
    });
    Model.define({
      // @ts-expect-error only a string or an integer is an enum
      at: { type: "datetime", enum: ["now"] },
    });
  });
});
