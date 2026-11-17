import { describe, expectTypeOf, test } from "vite-plus/test";
import { belongsTo, Model } from "../../packages/active-record/src/index.ts";

class Post extends Model.define({ id: "integer", title: "string" }) {
  static table = "posts";
}

class Photo extends Model.define({ id: "integer", title: "string" }) {
  static table = "photos";
}

class User extends Model.define({ id: "integer" }) {
  static table = "users";
}

class Remark extends Model.define({
  id: "integer",
  commentableType: "string",
  commentableId: "integer",
}) {
  static table = "remarks";

  commentable = belongsTo([Post, Photo]);
}

describe("a polymorphic belongsTo's types", () => {
  test("reads as a record of any listed Model, or null", () => {
    expectTypeOf<ReturnType<Remark["commentable"]>>().toEqualTypeOf<Promise<Post | Photo | null>>();
  });

  test("set takes a record of a listed Model, or null", () => {
    expectTypeOf<Parameters<Remark["commentable"]["set"]>[0]>().toEqualTypeOf<
      Post | Photo | null
    >();
    expectTypeOf<User>().not.toMatchTypeOf<Parameters<Remark["commentable"]["set"]>[0]>();
  });

  test("has no build or create: which Model to make isn't known", () => {
    expectTypeOf<Remark["commentable"]>().not.toHaveProperty("build");
    expectTypeOf<Remark["commentable"]>().not.toHaveProperty("create");
  });
});
