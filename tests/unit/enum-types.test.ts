import { describe, expect, expectTypeOf, test } from "vite-plus/test";
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

  test("a record has a predicate for each name, in camelCase", () => {
    class Task extends Model.define({
      state: { type: "string", enum: ["to_do", "in_progress"] },
    }) {}

    expectTypeOf<Article["isDraft"]>().toEqualTypeOf<() => boolean>();
    expectTypeOf<Article["isHigh"]>().toEqualTypeOf<() => boolean>();
    expectTypeOf<Task["isInProgress"]>().toEqualTypeOf<() => boolean>();
    expectTypeOf<Article>().not.toHaveProperty("isArchived");
  });

  test("a record has a saveAs… setter and its OrThrow for each name", () => {
    expectTypeOf<Article["saveAsPublished"]>().toEqualTypeOf<() => Promise<boolean>>();
    expectTypeOf<Article["saveAsHighOrThrow"]>().toEqualTypeOf<() => Promise<true>>();
  });

  test("a Model has a scope and a not… scope for each name, on its statics and Relations", () => {
    class Task extends Model.define({
      state: { type: "string", enum: ["to_do", "in_progress"] },
    }) {}

    expectTypeOf(Article.published).toBeFunction();
    expectTypeOf(Task.inProgress).toBeFunction();
    expectTypeOf(Task.notInProgress).toBeFunction();
    // Never called: a query needs a database.
    const chained = () => Article.where({ id: 1 }).notHigh().published();
    expectTypeOf(chained).returns.toHaveProperty("draft");
    expectTypeOf(Article).not.toHaveProperty("archived");
    expect(typeof Task.notInProgress).toBe("function");
  });

  test("prefix and suffix put a word around each name in every method's name", () => {
    class Conversation extends Model.define({
      status: { type: "string", enum: ["active", "archived"], prefix: true },
      comments: { type: "integer", enum: { open: 1, closed: 0 }, prefix: "comments" },
      priority: { type: "integer", enum: { active: 1 }, suffix: "level" },
    }) {}

    expectTypeOf<Conversation["isStatusActive"]>().toEqualTypeOf<() => boolean>();
    expectTypeOf<Conversation["saveAsCommentsClosedOrThrow"]>().toEqualTypeOf<
      () => Promise<true>
    >();
    expectTypeOf<Conversation["isActiveLevel"]>().toEqualTypeOf<() => boolean>();
    expectTypeOf(Conversation.notStatusArchived).toBeFunction();
    expectTypeOf(Conversation.activeLevel).toBeFunction();
    expectTypeOf<Conversation>().not.toHaveProperty("isActive");
    Model.define({
      // @ts-expect-error only an enum's attribute has a prefix
      flag: { type: "boolean", prefix: true },
    });
  });

  test("scopes: false and instanceMethods: false leave those methods out of the types", () => {
    class Quiet extends Model.define({
      status: { type: "string", enum: ["draft"], scopes: false },
      priority: { type: "integer", enum: { low: 0 }, instanceMethods: false },
    }) {}

    expectTypeOf<Quiet["isDraft"]>().toEqualTypeOf<() => boolean>();
    expectTypeOf<Quiet>().not.toHaveProperty("isLow");
    expectTypeOf<Quiet>().not.toHaveProperty("saveAsLow");
    expectTypeOf(Quiet.low).toBeFunction();
    expectTypeOf(Quiet).not.toHaveProperty("draft");
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
