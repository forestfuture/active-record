import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { belongsTo, hasMany, Model } from "../../packages/active-record/src/index.ts";
import { openHarness, type Harness } from "../support/harness.ts";

class Post extends Model.define({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
}) {
  static table = "posts";
}

class Project extends Model.define({
  id: { type: "integer", null: false },
  name: { type: "string", null: false },
}) {
  static table = "projects";
}

class Assignment extends Model.define({
  id: { type: "integer", null: false },
  userId: "integer",
  projectId: "integer",
}) {
  static table = "assignments";

  project = belongsTo(Project, { optional: true });
}

class User extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
}) {
  static table = "users";

  posts = hasMany(Post);
  titledA = hasMany(Post, { scope: (q) => q.where({ title: "A" }) });
  assignments = hasMany(Assignment);
  projects = hasMany(Project, { through: "assignments" });
}

// An association's owner link is never dropped by a rewrite (#350, decision 5 as revised).
describe("rewriting an association's query", () => {
  let harness: Harness;
  let db: ReturnType<Harness["connect"]>;
  let user: User;

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("assignments", "projects", "comments", "posts", "users");
    await harness.exec(
      "INSERT INTO users (id, email) VALUES (1, 'a@example.com'), (2, 'b@example.com')",
    );
    await harness.exec(
      "INSERT INTO posts (id, user_id, title) VALUES (10, 1, 'A'), (11, 1, 'B'), (12, 2, 'A')",
    );
    await harness.exec("INSERT INTO projects (id, name) VALUES (1, 'Apollo'), (2, 'Borealis')");
    await harness.exec(
      "INSERT INTO assignments (id, user_id, project_id) VALUES (1, 1, 1), (2, 2, 2)",
    );
    db = harness.connect();
    user = await db.model(User).findByOrThrow({ id: 1 });
  });

  test("unscope('where') keeps a hasMany's owner link, dropping the other conditions", async () => {
    const posts = user.posts().where({ title: "A" }).unscope("where");

    expect(await posts.order({ id: "asc" }).pluck("id")).toEqual([10, 11]);
  });

  test("unscope({ where }) and rewhere on the foreign key keep the owner link", async () => {
    expect(await user.posts().unscope({ where: "userId" }).count()).toBe(2);
    expect(await user.posts().rewhere({ userId: 2 }).count()).toBe(0);
  });

  test("only() keeps the owner link, whichever parts it keeps", async () => {
    const posts = user.posts().where({ title: "A" }).order({ id: "desc" });

    expect(await posts.only("order").pluck("id")).toEqual([11, 10]);
  });

  test("an unscope carried by merge keeps the owner link", async () => {
    const posts = user.posts().merge(db.model(Post).unscope("where"));

    expect(await posts.count()).toBe(2);
  });

  test("an association's own scope is dropped, its owner link kept", async () => {
    const titled = user.titledA().unscope({ where: "title" });

    expect(await titled.order({ id: "asc" }).pluck("id")).toEqual([10, 11]);
  });

  test("a through association's link is kept, for reads and writes", async () => {
    const other = user.projects().rewhere({ id: 2 });

    expect(await other.toArray()).toEqual([]);
    expect(await user.projects().unscope({ where: "id" }).pluck("id")).toEqual([1]);
    expect(await user.projects().unscope("where").pluck("id")).toEqual([1]);
  });

  test("a through association's write keeps its link, so another owner's rows stay", async () => {
    expect(await user.projects().rewhere({ id: 2 }).deleteAll()).toBe(0);
    expect(await db.model(Project).count()).toBe(2);
  });

  test("a record built after unscope('where') still belongs to the owner", () => {
    const built = user.posts().unscope("where").build({ title: "C" });

    expect(built.userId).toBe(1);
  });
});
