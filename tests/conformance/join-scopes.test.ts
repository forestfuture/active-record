import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  belongsTo,
  hasMany,
  IncompatibleRelation,
  Model,
  type Relation,
} from "../../packages/active-record/src/index.ts";
import { openHarness, type Harness } from "../support/harness.ts";

// The scopes a join takes into its ON clause, as Rails does: the association's, and the
// joined Model's default scopes.

class Writer extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  role: "string",
}) {
  static table = "users";

  articles = hasMany(Article, { foreignKey: "userId" });
  publishedArticles = hasMany(Article, {
    foreignKey: "userId",
    scope: (q: Relation<Article>) => q.where({ published: true }),
  });
  orderedArticles = hasMany(Article, {
    foreignKey: "userId",
    scope: (q: Relation<Article>) => q.order({ title: "desc" }),
  });
  firstArticles = hasMany(Article, {
    foreignKey: "userId",
    scope: (q: Relation<Article>) => q.limit(1),
  });
  noArticles = hasMany(Article, {
    foreignKey: "userId",
    scope: (q: Relation<Article>) => q.none(),
  });
  livePosts = hasMany(LivePost, { foreignKey: "userId" });
}

class Article extends Model.define({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
  published: { type: "boolean", null: false },
}) {
  static table = "posts";

  admin = belongsTo(Writer, {
    foreignKey: "userId",
    scope: (q: Relation<Writer>) => q.where({ role: "admin" }),
  });
}

// Three links to one table, two of them under aliases that differ only past Postgres's 63 bytes.
class Byline extends Model.define({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
}) {
  static table = "posts";

  writer = belongsTo(Writer, { foreignKey: "userId" });
  writerWhoseAssociationNameRunsPastWhatPostgresKeepsOfAnAliasOne = belongsTo(Writer, {
    foreignKey: "userId",
  });
  writerWhoseAssociationNameRunsPastWhatPostgresKeepsOfAnAliasTwo = belongsTo(Writer, {
    foreignKey: "userId",
  });
}

// A post that's only ever seen once published.
class LivePost extends Model.define({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  published: { type: "boolean", null: false },
}) {
  static table = "posts";

  static {
    this.defaultScope((q) => q.where({ published: true }));
  }
}

describe("joins with scopes", () => {
  let harness: Harness;
  const db = () => harness.connect();
  const idsOf = (records: readonly { id: number }[]) => records.map((record) => record.id);

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("comments", "posts", "profiles", "users");
    await harness.exec(
      "INSERT INTO users (id, email, role) VALUES (1, 'a@example.com', 'admin'), (2, 'b@example.com', 'guest'), (3, 'c@example.com', 'admin')",
    );
    await harness.exec(
      "INSERT INTO posts (id, user_id, title, published) VALUES (10, 1, 'A1', 1), (11, 2, 'B1', 0), (12, 3, 'C1', 1)",
    );
  });

  test("aliases past an identifier's length on Postgres still name each table once", async () => {
    const bylines = db()
      .model(Byline)
      .joins(
        "writer",
        "writerWhoseAssociationNameRunsPastWhatPostgresKeepsOfAnAliasOne",
        "writerWhoseAssociationNameRunsPastWhatPostgresKeepsOfAnAliasTwo",
      )
      .order({ id: "asc" });

    expect(idsOf(await bylines.toArray())).toEqual([10, 11, 12]);
  });

  test("an association's scope narrows the join", async () => {
    const writers = db().model(Writer).joins("publishedArticles").order({ id: "asc" });

    expect(idsOf(await writers.toArray())).toEqual([1, 3]);
  });

  test("a belongsTo's scope narrows the join", async () => {
    const articles = db().model(Article).joins("admin").order({ id: "asc" });

    expect(idsOf(await articles.toArray())).toEqual([10, 12]);
  });

  test("a left join keeps the records its scope finds no link for", async () => {
    const writers = db().model(Writer).leftJoins("publishedArticles").order({ id: "asc" });

    expect(idsOf(await writers.toArray())).toEqual([1, 2, 3]);
  });

  test("the joined Model's default scope narrows the join", async () => {
    const writers = db().model(Writer).joins("livePosts").order({ id: "asc" });

    expect(idsOf(await writers.toArray())).toEqual([1, 3]);
  });

  // A guard: an order can't change which rows a join finds, so it's left out, as Rails does.
  test("a scope's order is left out of the join", async () => {
    const writers = db().model(Writer).joins("orderedArticles").order({ id: "asc" });

    expect(idsOf(await writers.toArray())).toEqual([1, 2, 3]);
  });

  test("a none() scope joins nothing", async () => {
    expect(await db().model(Writer).joins("noArticles").toArray()).toEqual([]);
  });

  test("a scope with a limit can't be joined, which is said when the query is written", () => {
    expect(() => db().model(Writer).joins("firstArticles")).toThrow(IncompatibleRelation);
  });

  // A guard: the scoped associations above narrow only their own joins.
  test("an association without a scope joins every linked row", async () => {
    expect(idsOf(await db().model(Writer).joins("articles").toArray())).toHaveLength(3);
  });
});
