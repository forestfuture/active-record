import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import {
  belongsTo,
  hasMany,
  hasOne,
  InvalidModel,
  Model,
  NoDatabase,
  type HasMany,
  type HasManyThrough,
  type HasOneThrough,
  type Relation,
} from "../../packages/active-record/src/index.ts";
import type { LoadedValue } from "../../packages/active-record/src/model.ts";
import { connect } from "../../packages/active-record/src/adapters/d1/index.ts";
import { Post } from "../fixtures/models/post.ts";

// No D1 needed: these checks happen when a Model is first used.
const db = connect({} as never);

describe("association declarations", () => {
  test("an association named like an attribute or a record method is rejected", () => {
    class Shadow extends Model.define({ id: "integer", posts: "json" }) {
      static table = "users";
      posts = hasMany(Post, { foreignKey: "userId" });
    }
    class Clash extends Model.define({ id: "integer" }) {
      static table = "users";
      // A type error too (save is a record method); cast to reach the runtime check.
      save = hasMany(Post, { foreignKey: "userId" }) as never;
    }

    expect(() => db.model(Shadow)).toThrow(
      /Shadow association "posts" has the same name as an attribute; rename one of them/,
    );
    expect(() => db.model(Clash)).toThrow(InvalidModel);
  });

  test("a foreignKey that isn't a declared attribute is rejected", () => {
    class Typo extends Model.define({ id: "integer" }) {
      static table = "users";
      posts = hasMany(Post, { foreignKey: "user_id" });
    }
    class Owner extends Model.define({ id: "integer" }) {
      static table = "posts";
      author = belongsTo(Post, { foreignKey: "authorId" });
    }

    expect(() => db.model(Typo)).toThrow(/Typo.*"posts".*Post.*"user_id"/);
    expect(() => db.model(Owner)).toThrow(/Owner.*"author".*"authorId"/);
  });

  test("a target that isn't a Model is rejected", () => {
    class Lost extends Model.define({ id: "integer" }) {
      static table = "users";
      posts = hasMany("Post" as never, { foreignKey: "userId" }); // a type error too
    }

    expect(() => db.model(Lost)).toThrow(/Lost.*"posts".*Model/);
  });

  test("a record constructed directly has no Database, so its associations throw NoDatabase", () => {
    class User extends Model.define({ id: "integer" }) {
      posts = hasMany(Post);
    }

    expect(() => new User().posts()).toThrow(NoDatabase);
  });

  test("an inferred key that isn't declared is rejected, saying where it came from", () => {
    class APIKey extends Model.define({ id: "integer" }) {
      static table = "api_keys";
      posts = hasMany(Post); // APIKey → apiKeyId, which Post doesn't declare
    }
    class Draft extends Model.define({ id: "integer" }) {
      static table = "posts";
      writer = belongsTo(Post); // writer → writerId, which Draft doesn't declare
    }
    class BlogPost extends Model.define({ id: "integer" }) {
      static table = "users";
      comments = hasMany(Post); // BlogPost → blogPostId, through underscore
    }

    expect(() => db.model(APIKey)).toThrow(
      /APIKey association "posts": Post has no attribute "apiKeyId" \(inferred from the modelName APIKey/,
    );
    expect(() => db.model(Draft)).toThrow(
      /Draft association "writer": Draft has no attribute "writerId" \(inferred from the association name writer/,
    );
    expect(() => db.model(BlogPost)).toThrow(/Post has no attribute "blogPostId"/);
  });

  test("a class renamed by a bundler fails loudly, suggesting foreignKey", () => {
    // What a minifier without keep_names does: the class is now called e.
    const e = class extends Model.define({ id: "integer" }) {
      static table = "users";
      posts = hasMany(Post);
    };

    expect(() => db.model(e)).toThrow(
      /e association "posts": Post has no attribute "eId" \(inferred from the modelName e; declare it, or pass foreignKey \(and set static modelName/,
    );
  });

  test("a record constructed directly throws NoDatabase from every association method", () => {
    class Profile extends Model.define({ id: "integer", userId: "integer" }) {}
    class User extends Model.define({ id: "integer" }) {
      profile = hasOne(Profile);
    }
    class Note extends Model.define({ id: "integer", userId: "integer" }) {
      user = belongsTo(User);
    }
    const note = new Note();
    const user = new User();

    for (const call of [
      () => note.user.set(null),
      () => note.user.build(),
      () => note.user.create(),
      () => user.profile.createOrThrow(),
      () => user.profile.set(null),
    ]) {
      expect(call).toThrow(NoDatabase);
    }
  });

  test("a record made in another's field initializer keeps its associations", () => {
    class Comment extends Model.define({ id: "integer", noteId: "integer" }) {}
    class Note extends Model.define({ id: "integer" }) {
      comments = hasMany(Comment);
    }
    // Note is first used while a Board is being made, after Board's own first use.
    let pinning = false;
    class Board extends Model.define({ id: "integer" }) {
      pinned = pinning ? db.model(Note).build() : null;
    }
    db.model(Board).build();
    pinning = true;

    const board = db.model(Board).build();

    expect(board.pinned?.comments().build().noteId).toBeNull();
    expect(() => db.model(Note).includes("comments")).not.toThrow();
  });

  test("a record constructed directly in another's field initializer throws NoDatabase", () => {
    class Comment extends Model.define({ id: "integer", noteId: "integer" }) {}
    class Note extends Model.define({ id: "integer" }) {
      comments = hasMany(Comment);
    }
    class Board extends Model.define({ id: "integer" }) {
      draft = new Note();
    }

    const board = db.model(Board).build();

    expect(() => board.draft.comments()).toThrow(NoDatabase);
  });

  test("plain class fields stay on records, beside associations", () => {
    class User extends Model.define({ id: "integer" }) {
      greeting = "hello";
      posts = hasMany(Post);
    }

    const user = db.model(User).build({ id: 1 });

    expect(user.greeting).toBe("hello");
    expect(typeof user.posts().where).toBe("function");
  });

  test("an association assigned rather than defined (useDefineForClassFields: false) works", () => {
    // How a class field compiles without useDefineForClassFields, or below ES2022.
    class Writer extends Model.define({ id: "integer" }) {
      declare posts: HasMany<typeof Post>;
      constructor() {
        super();
        this.posts = hasMany(Post, { foreignKey: "userId" });
      }
    }

    db.model(Writer).build();
    const writer = db.model(Writer).build({ id: 1 });

    expect(typeof writer.posts().where).toBe("function");
  });

  test("a class with no name must give a hasMany its foreignKey", () => {
    const anonymous = [
      class extends Model.define({ id: "integer" }) {
        static table = "users";
        posts = hasMany(Post);
      },
    ][0]!;

    expect(() => db.model(anonymous)).toThrow(
      /has no class name to infer its foreign key from; pass foreignKey, or set static modelName/,
    );
  });
});

describe("an association through another's types (#59)", () => {
  class Tag extends Model.define({ id: "integer", name: "string" }) {
    static table = "tags";
  }
  class Tagging extends Model.define({ id: "integer", noteId: "integer", tagId: "integer" }) {
    static table = "taggings";
    tag = belongsTo(Tag);
    note = belongsTo(Note);
  }
  class Note extends Model.define({ id: "integer" }) {
    static table = "notes";
    taggings = hasMany(Tagging);
    tags = hasMany(Tag, { through: "taggings" });
  }
  class Mark extends Model.define({ id: "integer", taggingId: "integer" }) {
    static table = "marks";
    tagging = belongsTo(Tagging);
    note = hasOne(Note, { through: "tagging" });
  }

  test("a hasMany through another reads, preloads and loads like any hasMany", () => {
    expectTypeOf<Note["tags"]>().toEqualTypeOf<HasManyThrough<typeof Tag>>();
    expectTypeOf<ReturnType<Note["tags"]>>().toHaveProperty("where");
    expectTypeOf<LoadedValue<Note["tags"]>>().toEqualTypeOf<Tag[]>();
    expectTypeOf<Parameters<Note["loaded"]>[0]>().toEqualTypeOf<"taggings" | "tags">();
    expect(() => db.model(Note).includes("tags")).not.toThrow();
  });

  test("a hasMany through another has the collection methods, of its records", () => {
    expectTypeOf<ReturnType<Note["tags"]>["push"]>().parameters.toEqualTypeOf<Tag[]>();
    expectTypeOf<ReturnType<Note["tags"]>["delete"]>().returns.resolves.toEqualTypeOf<Tag[]>();
    expectTypeOf<ReturnType<Note["tags"]>["destroy"]>().parameters.toEqualTypeOf<Tag[]>();
    expectTypeOf<ReturnType<Note["tags"]>["clear"]>().returns.resolves.toEqualTypeOf<void>();
    expectTypeOf<ReturnType<Note["tags"]>["destroyAll"]>().returns.resolves.toEqualTypeOf<Tag[]>();
  });

  test("a hasMany through another builds and creates its records, and inserts none", () => {
    expectTypeOf<ReturnType<Note["tags"]>["build"]>().returns.toEqualTypeOf<Tag>();
    expectTypeOf<ReturnType<Note["tags"]>["create"]>().returns.resolves.toEqualTypeOf<Tag>();
    expectTypeOf<ReturnType<Note["tags"]>["insert"]>().toBeNever();
    expectTypeOf<ReturnType<Note["tags"]>["upsert"]>().toBeNever();
    expectTypeOf<ReturnType<Note["tags"]>["deleteAll"]>().returns.resolves.toEqualTypeOf<number>();
  });

  test("a hasMany through another is still a Relation, for or, merge and a batch's updateAll", () => {
    expectTypeOf<ReturnType<Note["tags"]>>().toExtend<Relation<Tag>>();
  });

  test("a hasOne through another reads its record, sets another, and builds none", () => {
    expectTypeOf<Mark["note"]>().toEqualTypeOf<HasOneThrough<typeof Note>>();
    expectTypeOf<ReturnType<Mark["note"]>>().resolves.toEqualTypeOf<Note | null>();
    expectTypeOf<LoadedValue<Mark["note"]>>().toEqualTypeOf<Note | null>();
    expectTypeOf<Mark["note"]["set"]>().parameters.toEqualTypeOf<[Note | null]>();
    expectTypeOf<Mark["note"]>().not.toHaveProperty("build");
    expectTypeOf<Mark["note"]>().not.toHaveProperty("create");
    expectTypeOf<Parameters<Mark["loaded"]>[0]>().toEqualTypeOf<"tagging" | "note">();
  });

  test("a hasMany through another's dependent removes join records, and a hasOne's has none", () => {
    expectTypeOf(hasMany(Tag, { through: "taggings", dependent: "deleteAll" })).toEqualTypeOf<
      HasManyThrough<typeof Tag>
    >();
    // @ts-expect-error -- nullify leaves join records that point at nothing
    hasMany(Tag, { through: "taggings", dependent: "nullify" });
    // @ts-expect-error -- a hasOne through another takes no dependent
    hasOne(Tag, { through: "taggings", dependent: "destroy" });
  });

  test("autosave isn't an option of a through association", () => {
    // @ts-expect-error -- autosave belongs to the hops of a through association
    hasOne(Tag, { through: "taggings", autosave: true });
  });

  test("inverseOf takes an association's name or false, and isn't an option of a through association", () => {
    hasMany(Tag, { inverseOf: "note" });
    hasOne(Tag, { inverseOf: false });
    belongsTo(Tag, { inverseOf: "note" });
    // @ts-expect-error -- true isn't a name: an inverse is inferred when inverseOf is left out
    hasMany(Tag, { inverseOf: true });
    // @ts-expect-error -- a through association's records hold no key of the owner's
    hasMany(Tag, { through: "taggings", inverseOf: "note" });
  });
});
