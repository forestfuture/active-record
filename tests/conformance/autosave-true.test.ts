import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { abort, hasMany, InvalidModel, Model } from "../../packages/active-record/src/index.ts";
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";

class Post extends Model.define({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
}) {
  static table = "posts";

  static {
    this.validates("title", { presence: true });
    this.beforeValidation((post) => {
      if (post.title === "abort") throw abort("not today");
    });
  }
}

class Author extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
}) {
  static table = "users";

  posts = hasMany(Post, { foreignKey: "userId", autosave: true });
}

/** The same table, with the default autosave: only new records. */
class PlainAuthor extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
}) {
  static table = "users";

  posts = hasMany(Post, { foreignKey: "userId" });
}

describe("autosave: true (#37)", () => {
  let harness: Harness;
  const events: QueryEvent[] = [];
  const db = () => harness.connect({ onQuery: (event) => events.push(event) });

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("comments", "profiles", "posts", "users");
    events.length = 0;
  });

  /** An author with two stored posts, its posts loaded. */
  async function authorWithPosts<M extends typeof Author | typeof PlainAuthor>(model: M) {
    await harness.exec("INSERT INTO users (id, email) VALUES (1, 'a@example.com')");
    await harness.exec("INSERT INTO posts (id, user_id, title) VALUES (10, 1, 'One')");
    await harness.exec("INSERT INTO posts (id, user_id, title) VALUES (11, 1, 'Two')");
    const author = await db().model(model).find(1);
    const posts = await author.posts().toArray();
    events.length = 0;
    return { author, posts };
  }

  const titles = () => db().model(Post).order({ id: "asc" }).pluck("title");

  test("saving the owner saves its loaded records that changed, even an owner with no changes", async () => {
    const { author, posts } = await authorWithPosts(Author);
    posts[0]!.title = "Changed";

    expect(await author.save()).toBe(true);

    expect(posts[0]!.isChanged()).toBe(false);
    expect(await titles()).toEqual(["Changed", "Two"]);
  });

  test("only the changed records are written", async () => {
    const { author, posts } = await authorWithPosts(Author);
    posts[1]!.title = "Changed";

    await author.saveOrThrow();

    const writes = events.filter(({ sql }) => !sql.startsWith("SELECT"));
    expect(writes).toHaveLength(1);
    expect(writes[0]!.sql).toMatch(/^UPDATE/);
  });

  test("guard: without autosave: true, a changed loaded record isn't saved", async () => {
    const { author, posts } = await authorWithPosts(PlainAuthor);
    posts[0]!.title = "Changed";

    await author.saveOrThrow();

    expect(posts[0]!.isChanged()).toBe(true);
    expect(await titles()).toEqual(["One", "Two"]);
  });

  test("guard: a record found without loading the association isn't saved", async () => {
    await harness.exec("INSERT INTO users (id, email) VALUES (1, 'a@example.com')");
    await harness.exec("INSERT INTO posts (id, user_id, title) VALUES (10, 1, 'One')");
    const author = await db().model(Author).find(1);
    const post = await author.posts().findByOrThrow({ title: "One" });
    post.title = "Changed";

    await author.saveOrThrow();

    expect(await titles()).toEqual(["One"]);
  });

  test("an invalid changed record's errors are copied onto the owner, under the association's name", async () => {
    const { author, posts } = await authorWithPosts(Author);
    posts[0]!.title = "";

    expect(await author.save()).toBe(false);

    expect(posts[0]!.errors.get("title")).toEqual(["can't be blank"]);
    expect(author.errors.get("posts.title")).toEqual(["can't be blank"]);
    expect(author.errors.fullMessages()).toEqual(["Posts title can't be blank"]);
    expect(await titles()).toEqual(["One", "Two"]);
  });

  test("a new record built through it reports its errors the same way", async () => {
    const author = db().model(Author).build({ email: "a@example.com" });
    author.posts().build({ title: "" });

    expect(await author.save()).toBe(false);

    expect(author.errors.toArray()).toEqual([
      { attribute: "posts.title", type: "blank", message: "can't be blank" },
    ]);
  });

  test('a changed record a callback aborts, with no errors to copy, is "is invalid"', async () => {
    const { author, posts } = await authorWithPosts(Author);
    posts[0]!.title = "abort";

    expect(await author.save()).toBe(false);

    expect(author.errors.fullMessages()).toEqual(["Posts is invalid"]);
    expect(await titles()).toEqual(["One", "Two"]);
  });

  test("guard: unchanged loaded records aren't validated", async () => {
    await harness.exec("INSERT INTO users (id, email) VALUES (1, 'a@example.com')");
    await harness.exec("INSERT INTO posts (id, user_id, title) VALUES (10, 1, '')");
    await harness.exec("INSERT INTO posts (id, user_id, title) VALUES (11, 1, 'Two')");
    const author = await db().model(Author).find(1);
    const [blank, other] = await author.posts().toArray();
    other!.title = "Changed";

    expect(await author.save()).toBe(true);
    expect(blank!.errors.isEmpty()).toBe(true);
  });

  test("autosave takes only true: anything else is an InvalidModel", () => {
    class Owner extends Model.define({ id: { type: "integer", null: false } }) {
      static table = "users";

      posts = hasMany(Post, { foreignKey: "userId", autosave: false } as never);
    }

    expect(() => db().model(Owner).build({ id: 1 })).toThrow(
      new InvalidModel('Owner association "posts": autosave takes true'),
    );
  });
});
