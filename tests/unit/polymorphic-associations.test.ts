import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import { belongsTo, InvalidModel, Model } from "../../packages/active-record/src/index.ts";
import { connect } from "../../packages/active-record/src/adapters/d1/index.ts";

// No D1 needed: these checks happen when a Model is first used.
const db = connect({} as never);

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

describe("a polymorphic belongsTo's declaration", () => {
  test("needs its type attribute", () => {
    class Untyped extends Model.define({ id: "integer", commentableId: "integer" }) {
      static table = "remarks";
      commentable = belongsTo([Post, Photo]);
    }
    class Renamed extends Model.define({ id: "integer", commentableId: "integer" }) {
      static table = "remarks";
      commentable = belongsTo([Post, Photo], { foreignType: "kind" });
    }

    expect(() => db.model(Untyped)).toThrow(
      new InvalidModel(
        'Untyped association "commentable": Untyped has no attribute "commentableType" (inferred from the association name commentable; declare it, or pass foreignType)',
      ),
    );
    expect(() => db.model(Renamed)).toThrow(
      new InvalidModel(
        'Renamed association "commentable": Renamed has no attribute "kind" (check foreignType)',
      ),
    );
  });

  test("needs each listed Model to have its own modelName", () => {
    const Anonymous = (() => class extends Model.define({ id: "integer" }) {})();
    class FeaturedPost extends Post {}
    class Nameless extends Model.define({
      id: "integer",
      commentableType: "string",
      commentableId: "integer",
    }) {
      static table = "remarks";
      commentable = belongsTo([Post, Anonymous]);
    }
    class Twice extends Model.define({
      id: "integer",
      commentableType: "string",
      commentableId: "integer",
    }) {
      static table = "remarks";
      commentable = belongsTo([Post, FeaturedPost]);
    }

    expect(() => db.model(Nameless)).toThrow(
      new InvalidModel(
        'Nameless association "commentable" lists a Model with no modelName to store as its type; set static modelName',
      ),
    );
    expect(() => db.model(Twice)).toThrow(
      new InvalidModel(
        'Twice association "commentable" lists Post and FeaturedPost, which are both stored as the type "Post"; list one of them',
      ),
    );
  });

  test("takes no scope, and lists at least one Model", () => {
    class Scoped extends Model.define({
      id: "integer",
      commentableType: "string",
      commentableId: "integer",
    }) {
      static table = "remarks";
      // A type error too; cast to reach the runtime check.
      commentable = belongsTo([Post, Photo], { scope: (q: never) => q } as never);
    }
    class Empty extends Model.define({
      id: "integer",
      commentableType: "string",
      commentableId: "integer",
    }) {
      static table = "remarks";
      commentable = belongsTo([] as never);
    }

    expect(() => db.model(Scoped)).toThrow(
      new InvalidModel('Scoped association "commentable": a polymorphic belongsTo takes no scope'),
    );
    expect(() => db.model(Empty)).toThrow(
      new InvalidModel('Empty association "commentable" must list the Models it can point at'),
    );
  });
});
