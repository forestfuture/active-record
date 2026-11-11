import { describe, expectTypeOf, test } from "vite-plus/test";
import {
  type AttributeConversions,
  belongsTo,
  between,
  gte,
  hasMany,
  hasOne,
  lt,
  Model,
  type HasMany,
  type QuerySql,
  type RecordStatement,
  Relation,
  sql,
  type TableAttributes,
} from "../../packages/active-record/src/index.ts";
import { d1, connect, withSession } from "../../packages/active-record/src/adapters/d1/index.ts";

class User extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  isActive: "boolean",
  createdAt: "datetime",
  ratio: "real",
  settings: "json",
}) {
  static table = "users";

  get label(): string {
    return this.email.toUpperCase();
  }
}

// connect() never touches the binding until a query runs, and these tests run none.
const db = connect({} as never);

// A generated schema, and an app's base class holding it.
const notes = { id: { type: "string", null: false }, body: "string", openedAt: "integer" } as const;
abstract class ApplicationRecord extends Model {
  static override schema = {
    adapter: d1({ binding: "DB" }),
    tables: { notes: { attributes: notes, primaryKey: "id" } },
    models: { Note: "notes" },
  } as const;
}

// The interface stands in for the declarations active-record schema generates in another file.
/* oxlint-disable typescript/no-unsafe-declaration-merging */
class Note extends ApplicationRecord {
  static override attributes = { openedAt: { type: "datetime", storage: "unixSeconds" } } as const;
}
interface Note extends TableAttributes<typeof notes, (typeof Note)["attributes"]> {}
/* oxlint-enable typescript/no-unsafe-declaration-merging */

describe("types", () => {
  test("record properties are inferred from Model.define({...}), nullable unless null: false", () => {
    expectTypeOf<User["id"]>().toEqualTypeOf<number>();
    expectTypeOf<User["email"]>().toEqualTypeOf<string>();
    expectTypeOf<User["isActive"]>().toEqualTypeOf<boolean | null>();
    expectTypeOf<User["createdAt"]>().toEqualTypeOf<Date | null>();
    expectTypeOf<User["ratio"]>().toEqualTypeOf<number | null>();
    expectTypeOf<User["settings"]>().toEqualTypeOf<unknown>();
  });

  test("a relation resolves to records of its model", () => {
    const relation = db.model(User);

    expectTypeOf(relation).toEqualTypeOf<Relation<User>>();
    expectTypeOf<ReturnType<typeof relation.toArray>>().toEqualTypeOf<Promise<User[]>>();
    expectTypeOf(db.models({ User }).User).toEqualTypeOf<Relation<User>>();
  });

  test("where accepts declared attributes with their value types, or an sql fragment", () => {
    const users = db.model(User);

    // Checked by the type checker only; never called.
    const typeOnly = () => {
      users.where({ isActive: true, createdAt: null });
      users.where(sql`email = ${"a@example.com"}`);
      // @ts-expect-error wrong value type for a boolean attribute
      users.where({ isActive: "yes" });
      // @ts-expect-error getters aren't attributes
      users.where({ label: "A" });
      // @ts-expect-error email can't be null
      users.where({ email: null });
      users.where({ id: [1, 2], isActive: [true, null] });
      // @ts-expect-error email can't be null, so null can't be in its array either
      users.where({ email: ["a@example.com", null] });
      // @ts-expect-error array items must have the attribute's type
      users.where({ id: ["1"] });
      users.where({ id: gte(2), createdAt: between(new Date(), new Date()), email: lt("m") });
      // @ts-expect-error a comparison's value must have the attribute's type
      users.where({ id: gte("2") });
      // @ts-expect-error nor can a comparison compare with null
      users.where({ createdAt: gte(null) });
      // @ts-expect-error booleans aren't ordered, so they can't be compared
      users.where({ isActive: gte(true) });
      // @ts-expect-error a comparison's parts are internal: build one with gt, gte, lt, lte or between
      void gte(1).operator;
      // @ts-expect-error likewise its values
      void between(1, 2).values;
    };
    expectTypeOf(typeOnly).toBeFunction();
  });

  test("order and reorder take directions, nulls placement, or an sql fragment", () => {
    const users = db.model(User);

    // Checked by the type checker only; never called.
    const typeOnly = () => {
      users.order({ createdAt: { direction: "desc", nulls: "last" }, id: "asc" });
      users.reorder(sql`lower(email)`);
      users.reorder();
      // @ts-expect-error nulls is "first" or "last"
      users.order({ createdAt: { direction: "desc", nulls: "never" } });
      // @ts-expect-error plain strings aren't orders
      users.order("email");
    };
    expectTypeOf(typeOnly).toBeFunction();
  });

  test("per-attribute change tracking is typed from the Model's attributes", () => {
    // Checked by the type checker only; never called.
    const typeOnly = (user: User) => {
      expectTypeOf(user.attributeWas("email")).toEqualTypeOf<string>();
      expectTypeOf(user.savedChangeTo("createdAt")).toEqualTypeOf<
        [before: Date | null, after: Date | null] | undefined
      >();
      user.isAttributeChanged("isActive", { from: false, to: true });
      user.restoreAttributes(["email", "isActive"]);
      // @ts-expect-error unknown attribute
      user.attributeWas("nope");
      // @ts-expect-error from must have the attribute's type
      user.hasSavedChangeTo("email", { from: 1 });
    };
    expectTypeOf(typeOnly).toBeFunction();
  });

  test("find with one id returns a record, with several or an array, records", () => {
    const users = db.model(User);

    // Checked by the type checker only; never called.
    const typeOnly = async () => {
      expectTypeOf(await users.find(1)).toEqualTypeOf<User>();
      expectTypeOf(await users.find(1, 2)).toEqualTypeOf<User[]>();
      expectTypeOf(await users.find([1, 2])).toEqualTypeOf<User[]>();
    };
    expectTypeOf(typeOnly).toBeFunction();
  });

  test("finders and pluck return precise types", () => {
    const users = db.model(User);

    expectTypeOf<ReturnType<typeof users.findBy>>().toEqualTypeOf<Promise<User | null>>();
    expectTypeOf<ReturnType<typeof users.first>>().toEqualTypeOf<Promise<User | null>>();

    // Checked by the type checker only; never called.
    const typeOnly = async () => {
      expectTypeOf(await users.pluck("email")).toEqualTypeOf<string[]>();
      expectTypeOf(await users.pluck("id", "isActive")).toEqualTypeOf<[number, boolean | null][]>();
    };
    expectTypeOf(typeOnly).toBeFunction();
  });

  test("order, select, pluck and count accept only declared attributes", () => {
    const users = db.model(User);

    // Checked by the type checker only; never called.
    const typeOnly = () => {
      users.order({ createdAt: "desc", id: "asc" }).select("email", "isActive").distinct();
      void users.count("isActive");
      // @ts-expect-error direction must be "asc" or "desc"
      users.order({ id: "up" });
      // @ts-expect-error getters aren't attributes
      users.order({ label: "asc" });
      // @ts-expect-error unknown attribute
      users.select("nope");
      // @ts-expect-error unknown attribute
      void users.pluck("nope");
      // @ts-expect-error unknown attribute
      void users.count("nope");
    };
    expectTypeOf(typeOnly).toBeFunction();
  });

  test("the record lifecycle API is typed against the Model's attributes", () => {
    const users = db.model(User);
    const user = users.build({ email: "a@example.com" });

    expectTypeOf(user).toEqualTypeOf<User>();
    expectTypeOf<ReturnType<typeof users.create>>().toEqualTypeOf<Promise<User>>();
    expectTypeOf<ReturnType<typeof users.createOrThrow>>().toEqualTypeOf<Promise<User>>();
    expectTypeOf<ReturnType<typeof user.save>>().toEqualTypeOf<Promise<boolean>>();
    expectTypeOf<ReturnType<typeof user.destroy>>().toEqualTypeOf<Promise<User | false>>();
    expectTypeOf<ReturnType<typeof user.destroyOrThrow>>().toEqualTypeOf<Promise<User>>();
    expectTypeOf<ReturnType<typeof user.reload>>().toEqualTypeOf<Promise<User>>();

    // Checked by the type checker only; never called.
    const typeOnly = async () => {
      user.assign({ isActive: true, createdAt: null });
      await user.update({ email: "b@example.com" });
      // @ts-expect-error unknown attribute
      users.build({ nope: 1 });
      // @ts-expect-error wrong value type
      user.assign({ isActive: "yes" });
      // @ts-expect-error email can't be null
      await user.update({ email: null });
    };
    expectTypeOf(typeOnly).toBeFunction();
  });

  test("validations and callbacks are typed against the Model", () => {
    // Checked by the type checker only; never called.
    const typeOnly = () => {
      class Account extends Model.define({
        id: "integer",
        email: { type: "string", null: false },
      }) {
        static table = "accounts";
        static {
          this.validates("email", { presence: true, if: (account) => account.email.length > 0 });
          this.beforeSave((account) => {
            expectTypeOf(account).toEqualTypeOf<Account>();
            expectTypeOf(account.email).toEqualTypeOf<string>();
          });
          // @ts-expect-error unknown attribute
          this.validates("nope", { presence: true });
          // @ts-expect-error unknown validator
          this.validates("email", { mustBe: "shiny" });
        }
      }
      return Account;
    };
    expectTypeOf(typeOnly).toBeFunction();
  });

  test("scope calls are typed through chaining", () => {
    class Post extends Model.define({
      id: "integer",
      published: "boolean",
      createdAt: "datetime",
    }) {
      static table = "posts";
      static published = this.scope((q) => q.where({ published: true }));
      static since = this.scope((q, date: Date) => q.where({ createdAt: date }));
      // Q6: sibling scopes aren't typed inside a scope body.
      // @ts-expect-error `published` isn't visible on q here
      static both = this.scope((q) => q.published());
    }
    const posts = db.model(Post);

    // Checked by the type checker only; never called.
    const typeOnly = () => {
      const chained = posts.where({ published: true }).published().since(new Date()).limit(5);
      expectTypeOf<ReturnType<typeof chained.toArray>>().toEqualTypeOf<Promise<Post[]>>();
      expectTypeOf(db.models({ Post }).Post.published).toBeFunction();
      // @ts-expect-error since() takes a Date
      posts.since("yesterday");
      // @ts-expect-error unknown scope
      posts.archived();
    };
    expectTypeOf(typeOnly).toBeFunction();
  });

  test("Relations and record statements can't be mixed up or made by hand", () => {
    class Other extends Model.define({ id: "integer", title: "string" }) {
      static table = "posts";
    }
    // Checked by the type checker only; never called.
    const typeOnly = (user: User) => {
      // @ts-expect-error Relations come from db.model() and other Relations
      void new Relation();
      void db.batch((b) => {
        // @ts-expect-error a record statement keeps its record's type
        const statement: RecordStatement<Other> = b.save(user);
        return [statement];
      });
    };
    expectTypeOf(typeOnly).toBeFunction();
  });

  test("db.batch resolves to each entry's result: the record, or the statement's WriteResult", () => {
    // Checked by the type checker only; never called.
    const typeOnly = async (user: User) => {
      const [saved, deleted, inserted] = await db.batch((b) => [
        b.save(user),
        b.deleteAll(db.model(User).where({ id: 1 })),
        b.insert(User, { id: 2 }, { returning: ["id", "email"] }),
      ]);
      expectTypeOf(saved).toEqualTypeOf<User>();
      expectTypeOf(deleted.rowsAffected).toEqualTypeOf<number>();
      expectTypeOf(deleted.rows).toEqualTypeOf<never[]>();
      expectTypeOf(inserted.rows).toEqualTypeOf<{ id: number; email: string }[]>();
    };
    expectTypeOf(typeOnly).toBeFunction();
  });

  test("a batch's callback can't be async, and a Batch's writes check their Model's attributes", () => {
    // Checked by the type checker only; never called.
    const typeOnly = async (user: User) => {
      // @ts-expect-error a batch is sent as one, so its callback can't await
      await db.batch(async (b) => [b.save(user)]);
      // @ts-expect-error an unknown attribute
      await db.batch((b) => [b.insert(User, { nope: 1 })]);
      // @ts-expect-error an unknown attribute, through a Relation
      await db.batch((b) => [b.updateAll(db.model(User).where({ id: 1 }), { nope: 1 })]);
      // @ts-expect-error writes are prepared by a Batch, not by the Relation
      void db.model(User).toInsert;
      // @ts-expect-error a save is prepared by a Batch, not by the record
      void user.toSave;
    };
    expectTypeOf(typeOnly).toBeFunction();
  });

  test("a bulk insert's rows are typed by returning: the attributes it names, any for the key, none for false", () => {
    // Checked by the type checker only; never called.
    const typeOnly = async () => {
      const users = db.model(User);
      const named = await users.insert({ id: 1 }, { returning: ["email", "createdAt"] });
      const keyed = await users.insertAll([{ id: 1 }]);
      const none = await users.upsert({ id: 1 }, { returning: false });
      expectTypeOf(named.rows).toEqualTypeOf<{ email: string; createdAt: Date | null }[]>();
      expectTypeOf(keyed.rows[0]?.id).toEqualTypeOf<number | undefined>();
      expectTypeOf(none.rows).toEqualTypeOf<never[]>();
      // @ts-expect-error: returning names the Model's attributes
      await users.insert({ id: 1 }, { returning: ["nope"] });
    };
    expectTypeOf(typeOnly).toBeFunction();
  });

  test("upsert's uniqueBy names the Model's attributes", () => {
    const users = db.model(User);

    // Checked by the type checker only; never called.
    const typeOnly = () => {
      void users.upsertAll([{ email: "a@example.com" }], { uniqueBy: "email" });
      void db.batch((b) => [b.upsert(users, { id: 1 }, { uniqueBy: ["id", "email"] })]);
      // @ts-expect-error unknown attribute
      void db.batch((b) => [b.upsert(User, { id: 1 }, { uniqueBy: "nope" })]);
      // @ts-expect-error onDuplicate only skips; updating is upsert
      void db.batch((b) => [b.insert(User, { id: 1 }, { onDuplicate: "update" })]);
    };
    expectTypeOf(typeOnly).toBeFunction();
  });

  test("dependent: takes the strategies of the association's kind", () => {
    // Checked by the type checker only; never called.
    const typeOnly = () => {
      class Owner extends Model.define({ id: "integer" }) {
        static table = "users";
        posts = hasMany(Owner, { foreignKey: "id", dependent: "deleteAll" });
        profile = hasOne(Owner, { foreignKey: "id", dependent: "delete" });
        // @ts-expect-error a hasOne deletes its one record with "delete", not "deleteAll"
        other = hasOne(Owner, { foreignKey: "id", dependent: "deleteAll" });
        // @ts-expect-error belongsTo has no dependent strategies
        parent = belongsTo(Owner, { foreignKey: "id", dependent: "destroy" });
      }
      return Owner;
    };
    expectTypeOf(typeOnly).toBeFunction();
  });

  test("an association scope's q is typed from the target, its scopes included", () => {
    class Article extends Model.define({ id: "integer", authorId: "integer", live: "boolean" }) {
      static live = this.scope((q) => q.where({ live: true }));
    }
    // Checked by the type checker only; never used.
    class Author extends Model.define({ id: "integer" }) {
      liveArticles = hasMany(Article, { scope: (q) => q.live().order({ id: "desc" }) });
      // @ts-expect-error Article has no "draft" scope
      drafts = hasMany(Article, { scope: (q) => q.draft() });
      // @ts-expect-error nor a "title" attribute
      titled = hasMany(Article, { scope: (q) => q.where({ title: "x" }) });
    }
    expectTypeOf<Author["liveArticles"]>().toEqualTypeOf<HasMany<typeof Article>>();
  });

  test("a self-referencing association whose scope uses the Model's own scopes annotates its field", () => {
    // TypeScript can't infer this one field's type from itself, so it's written out (ADR-0008).
    class Category extends Model.define({ id: "integer", parentId: "integer" }) {
      static top = this.scope((q) => q.where({ parentId: null }));
      children: HasMany<typeof Category> = hasMany(Category, {
        foreignKey: "parentId",
        scope: (q) => q.top(),
      });
      parent = belongsTo(Category, { foreignKey: "parentId" });
    }
    const typeOnly = async (category: Category) => {
      expectTypeOf(await category.children().top().toArray()).toEqualTypeOf<Category[]>();
      expectTypeOf(await category.parent()).toEqualTypeOf<Category | null>();
    };
    expectTypeOf(typeOnly).toBeFunction();
  });

  test("associations are typed from their fields, including includes() names", () => {
    class Author extends Model.define({ id: "integer" }) {
      static table = "users";
      articles = hasMany(Article, { foreignKey: "authorId" });
      bio = hasOne(Bio, { foreignKey: "authorId" });
    }
    class Article extends Model.define({ id: "integer", authorId: "integer", live: "boolean" }) {
      static table = "posts";
      author = belongsTo(Author, { foreignKey: "authorId" });
      static live = this.scope((q) => q.where({ live: true }));
    }
    class Bio extends Model.define({ id: "integer", authorId: "integer" }) {
      static table = "profiles";
    }

    // Checked by the type checker only; never called.
    const typeOnly = async (author: Author, article: Article) => {
      expectTypeOf(await article.author()).toEqualTypeOf<Author | null>();
      expectTypeOf(await author.bio()).toEqualTypeOf<Bio | null>();
      expectTypeOf(await author.articles().live().toArray()).toEqualTypeOf<Article[]>();
      expectTypeOf(author.loaded("articles")).toEqualTypeOf<Article[]>();
      expectTypeOf(author.loaded("bio")).toEqualTypeOf<Bio | null>();
      db.model(Author).includes("articles", "bio").includes({ articles: "author" });
      // @ts-expect-error unknown association
      db.model(Author).includes("posts");
      // @ts-expect-error unknown nested association
      db.model(Author).includes({ articles: "comments" });
      // @ts-expect-error attributes aren't associations
      author.loaded("id");
      expectTypeOf(author.isLoaded("bio")).toEqualTypeOf<boolean>();
      article.author.set(author);
      article.author.set(null);
      // @ts-expect-error set() takes a record of the association's Model
      article.author.set(article);
      expectTypeOf(article.author.build({ id: 1 })).toEqualTypeOf<Author>();
      expectTypeOf(await author.bio.createOrThrow({ id: 2 })).toEqualTypeOf<Bio>();
      // @ts-expect-error build() takes the target's attributes
      author.bio.build({ nope: 1 });
      expectTypeOf(await author.reloadAssociation("articles")).toEqualTypeOf<Article[]>();
      expectTypeOf(await article.reloadAssociation("author")).toEqualTypeOf<Author | null>();
      // @ts-expect-error unknown association
      await author.reloadAssociation("posts");
    };
    expectTypeOf(typeOnly).toBeFunction();
  });

  test("generateId is for string attributes, and generateId overrides keep a string", () => {
    class Note extends Model.define({ id: { type: "string", null: false, generateId: true } }) {}
    expectTypeOf<Note["id"]>().toEqualTypeOf<string>();

    // @ts-expect-error generated ids are strings
    Model.define({ id: { type: "integer", null: false, generateId: true } });
    // @ts-expect-error a generated id has no default
    Model.define({ id: { type: "string", generateId: true, default: () => "x" } });
    Model.define({ id: { type: "string", generateId: false, default: () => "x" } });

    const uuidv7 = () => "0190…";
    class Uuidv7Base extends Model {
      static override generateId = uuidv7;
    }
    class OwnIds extends Model.define({ id: { type: "string", null: false, generateId: true } }) {
      static override generateId(attribute: string) {
        return `${attribute}_${super.generateId(attribute)}`;
      }
    }
    class PrefixBase extends Model {
      static override generateId(attribute: string) {
        return `${attribute}_1`;
      }
    }
    // @ts-expect-error generateId returns a string
    class NumberBase extends Model {
      static override generateId = () => 42;
    }
    expectTypeOf([Uuidv7Base, PrefixBase, NumberBase, OwnIds]).toBeArray();
  });

  test("storage is for datetime attributes, as seconds or milliseconds (#73)", () => {
    class Entry extends Model.define({
      at: { type: "datetime", storage: "unixSeconds" },
      until: { type: "datetime", storage: "unixMilliseconds", null: false },
    }) {}
    expectTypeOf<Entry["at"]>().toEqualTypeOf<Date | null>();
    expectTypeOf<Entry["until"]>().toEqualTypeOf<Date>();

    // @ts-expect-error only a datetime is stored as an epoch
    Model.define({ at: { type: "integer", storage: "unixSeconds" } });
    // @ts-expect-error a storage is seconds or milliseconds
    Model.define({ at: { type: "datetime", storage: "minutes" } });
  });

  test("a misspelled key in a spec or override is a compile error", () => {
    // Compile-time checks only: the misspelled override also throws at runtime.
    const typeOnly = () => {
      // @ts-expect-error nul isn't a spec key
      Model.define({ id: { type: "string", nul: false } });
      // @ts-expect-error nul isn't a spec key
      ApplicationRecord.define({ id: { type: "string", nul: false } });
      // @ts-expect-error nul isn't an override key
      class Misspelled extends ApplicationRecord {
        static override attributes = { body: { nul: false } } as const;
      }
      Model.define({ id: { type: "string", null: false, column: "note_id", default: () => "x" } });
      class Required extends ApplicationRecord {
        static override attributes = {
          body: { type: "string", null: false, default: () => "" },
        } as const;
      }
      return [Misspelled, Required];
    };
    expectTypeOf(typeOnly).toBeFunction();
  });

  test("a page from paginate({ count: false }) has no total", () => {
    const typeOnly = async () => {
      const counted = await db.model(User).paginate({ page: 1 });
      const countless = await User.paginate({ page: 1, count: false });
      expectTypeOf(counted.total).toEqualTypeOf<number>();
      expectTypeOf(counted.records).toEqualTypeOf<User[]>();
      expectTypeOf(countless.records).toEqualTypeOf<User[]>();
      // @ts-expect-error a countless page has no total
      expectTypeOf(countless.total).toBeNumber();
      // @ts-expect-error a countless page has no totalPages
      expectTypeOf(countless.totalPages).toBeNumber();
    };
    expectTypeOf(typeOnly).toBeFunction();
  });

  test("toSql gives the SQL and its bound values, of a Relation or a Model", () => {
    const typeOnly = () => {
      expectTypeOf(db.model(User).where({ isActive: true }).toSql()).toEqualTypeOf<QuerySql>();
      expectTypeOf(User.toSql()).toEqualTypeOf<QuerySql>();
      expectTypeOf<QuerySql>().toEqualTypeOf<{ sql: string; params: unknown[] }>();
    };
    expectTypeOf(typeOnly).toBeFunction();
  });

  test("typeForAttribute's conversions are typed by the attribute, and its name is checked (#148)", () => {
    const typeOnly = () => {
      expectTypeOf(User.typeForAttribute("createdAt")).toEqualTypeOf<
        AttributeConversions<Date | null>
      >();
      expectTypeOf(User.typeForAttribute("id").cast("1")).toEqualTypeOf<number>();
      expectTypeOf(User.typeForAttribute("email").deserialize("a")).toEqualTypeOf<string>();
      expectTypeOf(User.typeForAttribute("isActive").serialize(true)).toEqualTypeOf<
        string | number | null
      >();
      // @ts-expect-error not an attribute of User
      User.typeForAttribute("nope");
      // @ts-expect-error a method isn't an attribute
      User.typeForAttribute("label");
    };
    expectTypeOf(typeOnly).toBeFunction();
  });

  test("typeForAttribute on a generated Model follows its overrides, and checks the name (#148)", () => {
    const typeOnly = () => {
      expectTypeOf(Note.typeForAttribute("openedAt")).toEqualTypeOf<
        AttributeConversions<Date | null>
      >();
      expectTypeOf(Note.typeForAttribute("id").cast("a")).toEqualTypeOf<string>();
      // @ts-expect-error not an attribute of Note
      Note.typeForAttribute("closedAt");
    };
    expectTypeOf(typeOnly).toBeFunction();
  });

  test("withSession takes a cookie or a header for the bookmark, not both (#220)", () => {
    const typeOnly = (request: Request, binding: Parameters<typeof withSession>[1]) => {
      const ok = () => new Response("ok");
      expectTypeOf(withSession(request, binding, ok)).toEqualTypeOf<Promise<Response>>();
      void withSession(request, binding, { cookie: "replica", start: "first-primary" }, ok);
      void withSession(request, binding, { header: "x-d1-bookmark", onQuery: () => {} }, ok);
      // @ts-expect-error a cookie or a header, not both
      void withSession(request, binding, { cookie: "replica", header: "x-d1-bookmark" }, ok);
      // @ts-expect-error the bookmark comes from the request
      void withSession(request, binding, { session: "first-primary" }, ok);
      // @ts-expect-error fn returns the Response
      void withSession(request, binding, () => "ok");
    };
    expectTypeOf(typeOnly).toBeFunction();
  });
});
