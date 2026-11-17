import { describe, expectTypeOf, test } from "vite-plus/test";
import { belongsTo, Model } from "../../packages/active-record/src/index.ts";

class Post extends Model.define({ id: "integer", title: "string" }) {
  static table = "posts";
}

class Photo extends Model.define({ id: "integer", title: "string" }) {
  static table = "photos";
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
});
