import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import { belongsTo, hasMany, InvalidModel, Model } from "../../packages/active-record/src/index.ts";
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

  test("takes no scope", () => {
    class Scoped extends Model.define({
      id: "integer",
      commentableType: "string",
      commentableId: "integer",
    }) {
      static table = "remarks";
      // A type error too; cast to reach the runtime check.
      commentable = belongsTo([Post, Photo], { scope: (q: never) => q } as never);
    }

    expect(() => db.model(Scoped)).toThrow(
      new InvalidModel('Scoped association "commentable": a polymorphic belongsTo takes no scope'),
    );
  });

  test("lists at least one Model", () => {
    class Empty extends Model.define({
      id: "integer",
      commentableType: "string",
      commentableId: "integer",
    }) {
      static table = "remarks";
      commentable = belongsTo([] as never);
    }

    expect(() => db.model(Empty)).toThrow(
      new InvalidModel('Empty association "commentable" must list the Models it can point at'),
    );
  });
});

describe("a hasMany or hasOne with as:", () => {
  test("needs the target's type attribute", () => {
    class Bare extends Model.define({ id: "integer", commentableId: "integer" }) {
      static table = "remarks";
    }
    class Album extends Model.define({ id: "integer" }) {
      static table = "photos";
      remarks = hasMany(Bare, { as: "commentable" });
    }

    expect(() => db.model(Album)).toThrow(
      new InvalidModel(
        'Album association "remarks": Bare has no attribute "commentableType" (inferred from as: "commentable"; declare it, or pass foreignType)',
      ),
    );
  });

  test("must be the other side of a polymorphic belongsTo that lists its Model", () => {
    class Plain extends Model.define({
      id: "integer",
      commentableType: "string",
      commentableId: "integer",
    }) {
      static table = "remarks";
      commentable = belongsTo(Post);
    }
    class Album extends Model.define({ id: "integer" }) {
      static table = "photos";
      plain = hasMany(Plain, { as: "commentable" });
      remarks = hasMany(Remark, { as: "commentable" });
    }
    class Unlisted extends Model.define({ id: "integer" }) {
      static table = "photos";
      remarks = hasMany(Remark, { as: "commentable" });
    }

    expect(() => db.model(Album)).toThrow(
      new InvalidModel(
        'Album association "plain": Plain.commentable isn\'t a polymorphic belongsTo; declare it belongsTo([Album, …])',
      ),
    );
    expect(() => db.model(Unlisted)).toThrow(
      new InvalidModel(
        'Unlisted association "remarks": Remark.commentable doesn\'t list Unlisted; add it to belongsTo([…])',
      ),
    );
  });
});
