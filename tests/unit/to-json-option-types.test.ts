import { describe, expectTypeOf, test } from "vite-plus/test";
import { belongsTo, hasMany, Model } from "../../packages/arbor/src/index.ts";

class Author extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  title: { aliasOf: "email" },
}) {
  articles = hasMany(Article, { foreignKey: "authorId" });

  get handle(): string {
    return this.email.split("@")[0]!;
  }

  initials(): string {
    return this.email.slice(0, 2);
  }

  greet(name: string): string {
    return `Hi ${name}`;
  }

  async rank(): Promise<number> {
    return this.id;
  }
}

class Article extends Model.define({
  id: { type: "integer", null: false },
  authorId: "integer",
  headline: "string",
}) {
  author = belongsTo(Author, { foreignKey: "authorId" });
  notes = hasMany(Note, { foreignKey: "articleId" });
}

class Note extends Model.define({ id: "integer", articleId: "integer" }) {}

// What toJSON's options accept, checked against the record's own names (#300).
describe("toJSON options' types", () => {
  test("include takes what includes() does, and options under an association's name", () => {
    // Checked by the type checker only; never called.
    const typeOnly = (author: Author) => {
      expectTypeOf(author.toJSON({ include: "articles" })).toEqualTypeOf<Record<string, unknown>>();
      author.toJSON({ include: ["articles"] });
      author.toJSON({ include: { articles: "notes" } });
      author.toJSON({ include: { articles: ["author", "notes"] } });
      author.toJSON({ include: { articles: { only: ["headline"], include: "notes" } } });
      // @ts-expect-error unknown association
      author.toJSON({ include: "posts" });
      // @ts-expect-error unknown nested association
      author.toJSON({ include: { articles: "comments" } });
      // @ts-expect-error an attribute of the author, not of its articles
      author.toJSON({ include: { articles: { only: ["email"] } } });
    };
    expectTypeOf(typeOnly).toBeFunction();
  });

  test("only and except take attribute names, aliases included, and not both", () => {
    const typeOnly = (author: Author) => {
      author.toJSON({ only: ["id", "email"] });
      author.toJSON({ except: ["title"] });
      // @ts-expect-error not an attribute
      author.toJSON({ only: ["emial"] });
      // @ts-expect-error an association isn't an attribute
      author.toJSON({ except: ["articles"] });
      // @ts-expect-error only or except, not both
      author.toJSON({ only: ["id"], except: ["email"] });
    };
    expectTypeOf(typeOnly).toBeFunction();
  });

  test("methods takes getters and methods with no arguments that don't return a promise", () => {
    const typeOnly = (author: Author) => {
      author.toJSON({ methods: ["handle", "initials"] });
      // @ts-expect-error takes an argument
      author.toJSON({ methods: ["greet"] });
      // @ts-expect-error returns a promise
      author.toJSON({ methods: ["rank"] });
      // @ts-expect-error no such member
      author.toJSON({ methods: ["nickname"] });
    };
    expectTypeOf(typeOnly).toBeFunction();
  });

  test("a string, as JSON.stringify passes, is accepted", () => {
    const typeOnly = (author: Author) => {
      author.toJSON("0");
      author.toJSON();
    };
    expectTypeOf(typeOnly).toBeFunction();
  });
});
