import { afterAll, beforeAll, describe, expect, expectTypeOf, test, vi } from "vite-plus/test";
import { runSchema } from "../../../packages/active-record/cli/schema/command.ts";
import { connect, type QueryEvent } from "../../../packages/active-record/src/adapters/d1/index.ts";
import { audited } from "../../fixtures/models/auditable.ts";
import { Comment } from "../../fixtures/models/comment.ts";
import { Event } from "../../fixtures/models/event.ts";
import { Customer } from "../../fixtures/models/customer.ts";
import { Post } from "../../fixtures/models/post.ts";
import { saved, DbRecord } from "../../fixtures/models/db-record.ts";
import { User } from "../../fixtures/models/user.ts";
import { createTestDatabase, type TestDatabase } from "../../support/d1.ts";

// Statics read the Worker's bindings from cloudflare:workers; here it's this test's D1.
const workers: { env: Record<string, unknown> } = { env: {} };
vi.mock("cloudflare:workers", () => workers);

describe("Models extending the app's base class", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;
  const db = () => connect(binding);

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
    workers.env.DB = binding;
  });
  afterAll(() => dispose());

  test("the fixtures' schemas are what their migrations and Models generate", async () => {
    const cwd = new URL("../../fixtures/", import.meta.url).pathname;
    const output: string[] = [];

    const options = { cwd, models: "models", out: ".", check: true };

    expect(await runSchema(options, (line) => output.push(line))).toBe(0);
  });

  test("a Model has its table's attributes, its table named after its class", async () => {
    const user = await db().model(User).create({ email: "ada@example.com" });
    const post = await db().model(Post).create({ userId: user.id, title: "Hello" });

    const found = await db().model(Post).find(post.id);

    expect(found.title).toBe("Hello");
    expect(found.shout).toBe("HELLO");
    expect(Post.table).toBe("posts");
  });

  test("its statics query the binding in the generated schema", async () => {
    const user = await User.create({ email: "grace@example.com" });
    await Post.create({ userId: user.id, title: "First" });
    await Post.create({ userId: user.id, title: "Second" });

    const titles = await Post.where({ userId: user.id }).order({ title: "desc" }).pluck("title");
    const titled = await Post.titled("First").toArray();

    expect(titles).toEqual(["Second", "First"]);
    expect(titled.map((post) => post.title)).toEqual(["First"]);
  });

  test("build and permit take its attributes, and only those", () => {
    const input = { title: "Draft", admin: true };

    const post = Post.build(Post.permit(input, "title"));

    expect(post.attributes()).toMatchObject({ title: "Draft" });
    expect(post).not.toHaveProperty("admin");
  });

  test("static table names a table the class name doesn't give", async () => {
    const customer = await Customer.create({ htmlUrl: "https://example.com" });

    const found = await Customer.find(customer.id);

    expect(found.htmlUrl).toBe("https://example.com");
    expect(Customer.table).toBe("accounts");
  });

  test("static attributes change how a column reads, in its type and its value", async () => {
    const post = await Post.create({ userId: 1, title: "Out", published: true });

    const found = await Post.find(post.id);

    expect(found.published).toBe(true);
    expectTypeOf(found.published).toEqualTypeOf<boolean>();
  });

  test("an attribute overridden as false is never read, so queries name their columns", async () => {
    const events: QueryEvent[] = [];
    await connect(binding, { onQuery: (event) => events.push(event) })
      .model(Customer)
      .toArray();

    expect(events[0]?.sql).not.toContain("*");
    expect(events[0]?.sql).not.toContain("person_identifier");
    expect(Customer.build({})).not.toHaveProperty("personIdentifier");
    expectTypeOf<Customer>().not.toHaveProperty("personIdentifier");
  });

  test("a subclass shares its parent's table, and its records are the subclass's", async () => {
    class FeaturedPost extends Post {}
    await Post.create({ userId: 1, title: "Featured" });

    const found = await FeaturedPost.findByOrThrow({ title: "Featured" });

    expect(found).toBeInstanceOf(FeaturedPost);
    expect(found.title).toBe("Featured");
    expect(FeaturedPost.table).toBe("posts");
  });

  test("the base class's methods, scopes and callbacks are every Model's", async () => {
    saved.length = 0;
    const post = await Post.create({ userId: 1, title: "Newest" });

    const newest = await Post.newest().first();

    expect(saved).toEqual(["Post"]);
    expect(newest?.title).toBe("Newest");
    expect(post.label()).toBe(`Post ${post.id}`);
  });

  test("a class marked abstract shares its callbacks, and the classes below it have tables", async () => {
    const user = await User.create({ email: "abstract@example.com" });
    const post = await Post.create({ userId: user.id, title: "Commented" });
    audited.length = 0;

    await Comment.create({ postId: post.id, body: "Agreed" });

    expect(audited).toEqual(["Comment"]);
    expect(Comment.table).toBe("comments");
  });

  test("associations between generated Models load, and preload in one batch", async () => {
    const user = await User.create({ email: "lin@example.com" });
    const post = await Post.create({ userId: user.id, title: "Linked" });
    await Comment.create({ postId: post.id, body: "First" });
    await user.profile.create({ bio: "Writes" });
    const events: QueryEvent[] = [];
    const recorded = connect(binding, { onQuery: (event) => events.push(event) });

    const [found] = await recorded
      .model(User)
      .where({ id: user.id })
      .includes("profile", { posts: "comments" })
      .toArray();

    expect(found?.loaded("profile")?.bio).toBe("Writes");
    expect(found?.loaded("posts").map((each) => each.title)).toEqual(["Linked"]);
    expect(found?.loaded("posts")[0]?.loaded("comments")[0]?.body).toBe("First");
    expect((await post.user())?.email).toBe("lin@example.com");
    expect(events).toHaveLength(4);
  });

  test("a subclass's associations use its parent's foreign keys", async () => {
    class FeaturedPost extends Post {}
    const post = await FeaturedPost.create({ userId: 1, title: "Starred" });
    await Comment.create({ postId: post.id, body: "Nice" });

    const bodies = (await post.comments().toArray()).map((comment) => comment.body);

    expect(bodies).toEqual(["Nice"]);
  });

  test("Models on two base classes query their own schema's databases", async () => {
    const logs = await createTestDatabase(
      new URL("../../fixtures/migrations/logs/0001_logs.sql", import.meta.url),
    );
    workers.env.LOGS = logs.db;

    try {
      await Event.create({ name: "signup" });
      await User.create({ email: "logged@example.com" });

      const { results } = await logs.db.prepare("SELECT name FROM events").all();
      expect(results).toEqual([{ name: "signup" }]);
      expect(await User.where({ email: "logged@example.com" }).exists()).toBe(true);
    } finally {
      await logs.dispose();
    }
  });

  test("define on the base class declares a Model's attributes, sharing the base", async () => {
    class Sample extends DbRecord.define({
      id: { type: "integer", null: false },
      quantity: "integer",
    }) {}
    saved.length = 0;

    const sample = await Sample.create({ quantity: 3 });

    expect((await Sample.find(sample.id)).quantity).toBe(3);
    expect(sample.label()).toBe(`Sample ${sample.id}`);
    expect(saved).toEqual(["Sample"]);
  });
});
