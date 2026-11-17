import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  belongsTo,
  hasMany,
  hasOne,
  type HasManyCollection,
  InvalidModel,
  Model,
  ReadonlyAssociation,
  RecordNotFound,
} from "../../packages/active-record/src/index.ts";
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";

class Project extends Model.define({
  id: { type: "integer", null: false },
  name: { type: "string", null: false },
  archived: { type: "integer", null: false },
}) {
  static table = "projects";

  static unarchived = this.scope((q) => q.where({ archived: 0 }));

  assignments = hasMany(Assignment);
  members = hasMany(User, { through: "assignments", source: "user" });
}

class Assignment extends Model.define({
  id: { type: "integer", null: false },
  userId: "integer",
  projectId: "integer",
  role: "string",
}) {
  static table = "assignments";

  user = belongsTo(User, { optional: true });
  project = belongsTo(Project, { optional: true });
  teammates = hasMany(Assignment, { through: "project", source: "assignments" });
  teamUsers = hasMany(User, { through: "project", source: "members" });
  liveProject = belongsTo(LiveProject, { foreignKey: "projectId", optional: true });
  activeProject = belongsTo(Project, {
    foreignKey: "projectId",
    optional: true,
    scope: (q) => q.where({ archived: 0 }),
  });
}

class User extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
}) {
  static table = "users";

  assignments = hasMany(Assignment);
  projects = hasMany(Project, { through: "assignments" });
  coworkerAssignments = hasMany(Assignment, { through: "projects", source: "assignments" });
  collaborators = hasMany(User, { through: "projects", source: "members" });
  teammates = hasMany(User, { through: "assignments", source: "teamUsers" });
  posts = hasMany(Post);
  comments = hasMany(Comment, { through: "posts" });
  profile = hasOne(Profile);
  liveProjects = hasMany(LiveProject, { through: "assignments", source: "liveProject" });
  assignmentsByRole = hasMany(Assignment, { scope: (q) => q.order({ role: "desc" }) });
  projectsByRole = hasMany(Project, { through: "assignmentsByRole", source: "project" });
  profilePosts = hasMany(Post, { through: "profile", source: "posts" });
  self = hasOne(User, { through: "profile", source: "user" });
  selves = hasMany(User, { through: "profile", source: "user" });
  leads = hasMany(Assignment, { scope: (q) => q.where({ role: "lead" }) });
  ledProjects = hasMany(Project, { through: "leads", source: "project" });
  activeProjects = hasMany(Project, { through: "assignments", source: "activeProject" });
  unarchivedProjects = hasMany(Project, {
    through: "assignments",
    source: "project",
    scope: (q) => q.where({ archived: 0 }),
  });
}

class Post extends Model.define({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
}) {
  static table = "posts";

  user = belongsTo(User);
  comments = hasMany(Comment);
  authorProfile = hasOne(Profile, { through: "user", source: "profile" });
}

/** Projects, but only those not archived, by default. */
class LiveProject extends Model.define({
  id: { type: "integer", null: false },
  name: { type: "string", null: false },
  archived: { type: "integer", null: false },
}) {
  static table = "projects";

  static {
    this.defaultScope((q) => q.where({ archived: 0 }));
  }
}

class Comment extends Model.define({
  id: { type: "integer", null: false },
  postId: "integer",
  body: "string",
}) {
  static table = "comments";
}

class Profile extends Model.define({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  bio: "string",
}) {
  static table = "profiles";

  user = belongsTo(User);
  posts = hasMany(Post, { foreignKey: "userId", primaryKey: "userId" });
}

const userAttributes = {
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
} as const;

/** Users whose through associations are misdeclared, one way each. */
const misdeclared = {
  NoVia: class extends Model.define(userAttributes) {
    static table = "users";
    projects = hasMany(Project, { through: "missing" });
  },
  NoSource: class extends Model.define(userAttributes) {
    static table = "users";
    assignments = hasMany(Assignment, { foreignKey: "userId" });
    tasks = hasMany(Project, { through: "assignments" });
  },
  NoNamedSource: class extends Model.define(userAttributes) {
    static table = "users";
    assignments = hasMany(Assignment, { foreignKey: "userId" });
    projects = hasMany(Project, { through: "assignments", source: "missing" });
  },
  OtherTarget: class extends Model.define(userAttributes) {
    static table = "users";
    assignments = hasMany(Assignment, { foreignKey: "userId" });
    projects = hasMany(Assignment, { through: "assignments", source: "project" });
  },
  ThroughItself: class extends Model.define(userAttributes) {
    static table = "users";
    projects = hasMany(Project, { through: "projects" });
  },
  OneOfMany: class extends Model.define(userAttributes) {
    static table = "users";
    assignments = hasMany(Assignment, { foreignKey: "userId" });
    project = hasOne(Project, { through: "assignments" });
  },
  BelongsToThrough: class extends Model.define(userAttributes) {
    static table = "users";
    assignments = hasMany(Assignment, { foreignKey: "userId" });
    // @ts-expect-error -- a belongsTo goes through nothing
    project = belongsTo(Project, { through: "assignments" });
  },
  Circular: class extends Model.define(userAttributes) {
    static table = "users";
    projects = hasMany(Project, { through: "others" });
    others = hasMany(Project, { through: "projects" });
  },
  Dependent: class extends Model.define(userAttributes) {
    static table = "users";
    assignments = hasMany(Assignment, { foreignKey: "userId" });
    // @ts-expect-error -- a type error too; this shows the runtime check
    projects = hasMany(Project, { through: "assignments", dependent: "nullify" });
  },
  DependentThroughHasOne: class extends Model.define(userAttributes) {
    static table = "users";
    profile = hasOne(Profile, { foreignKey: "userId" });
    selves = hasMany(User, { through: "profile", source: "user", dependent: "deleteAll" });
  },
  DependentNested: class extends Model.define(userAttributes) {
    static table = "users";
    assignments = hasMany(Assignment, { foreignKey: "userId" });
    projects = hasMany(Project, { through: "assignments" });
    collaborators = hasMany(User, { through: "projects", source: "members", dependent: "destroy" });
  },
  OneDependent: class extends Model.define(userAttributes) {
    static table = "users";
    assignment = hasOne(Assignment, { foreignKey: "userId" });
    // @ts-expect-error -- a type error too; this shows the runtime check
    project = hasOne(Project, { through: "assignment", dependent: "destroy" });
  },
  Autosaved: class extends Model.define(userAttributes) {
    static table = "users";
    assignments = hasMany(Assignment, { foreignKey: "userId" });
    // @ts-expect-error -- a type error too; this shows the runtime check
    projects = hasMany(Project, { through: "assignments", autosave: true });
  },
  Keyed: class extends Model.define(userAttributes) {
    static table = "users";
    assignments = hasMany(Assignment, { foreignKey: "userId" });
    // @ts-expect-error -- a type error too; this shows the runtime check
    projects = hasMany(Project, { through: "assignments", foreignKey: "userId" });
  },
};

describe("an association through another", () => {
  let harness: Harness;
  let database: ReturnType<Harness["connect"]>;
  const queries: QueryEvent[] = [];
  const db = () => database;
  const names = (projects: readonly Project[]) => projects.map((project) => project.name);

  beforeAll(async () => {
    harness = await openHarness();
    database = harness.connect({ onQuery: (event) => void queries.push(event) });
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("assignments", "projects", "comments", "profiles", "posts", "users");
    await harness.exec(
      "INSERT INTO users (id, email) VALUES (1, 'a@example.com'), (2, 'b@example.com')",
    );
    await harness.exec(
      "INSERT INTO projects (id, name) VALUES (1, 'Apollo'), (2, 'Borealis'), (3, 'Cygnus')",
    );
    await harness.exec(
      "INSERT INTO assignments (id, user_id, project_id, role) VALUES (1, 1, 3, 'lead'), (2, 1, 1, 'member'), (3, 2, 2, 'lead')",
    );
  });

  test("reads the target records its owner's join records point at", async () => {
    const user = await db().model(User).find(1);

    expect(names(await user.projects().toArray())).toEqual(["Apollo", "Cygnus"]);
  });

  test("answers every Relation method, narrowed to the owner's records", async () => {
    const user = await db().model(User).find(1);

    expect(names(await user.projects().where({ name: "Cygnus" }).toArray())).toEqual(["Cygnus"]);
    expect(names(await user.projects().order({ name: "desc" }).toArray())).toEqual([
      "Cygnus",
      "Apollo",
    ]);
    expect(await user.projects().count()).toBe(2);
    expect(await user.projects().pluck("name")).toEqual(["Apollo", "Cygnus"]);
    expect((await user.projects().first())?.name).toBe("Apollo");
    expect((await user.projects().find(3)).name).toBe("Cygnus");
    await expect(user.projects().find(2)).rejects.toThrow(RecordNotFound);
  });

  test("reads through the scope of the association it goes through", async () => {
    const user = await db().model(User).find(1);

    expect(names(await user.ledProjects().toArray())).toEqual(["Cygnus"]);
  });

  test("has its target's scopes, and its target's default scope applies", async () => {
    await harness.exec("UPDATE projects SET archived = 1 WHERE id = 3");
    const user = await db().model(User).find(1);

    expect(names(await user.projects().unarchived().toArray())).toEqual(["Apollo"]);
    expect((await user.liveProjects().toArray()).map((each) => each.name)).toEqual(["Apollo"]);
  });

  test("keeps its targets' order, not the order of the association it goes through", async () => {
    const user = await db().model(User).find(1);
    const [preloaded] = await db()
      .model(User)
      .includes("projectsByRole")
      .where({ id: 1 })
      .toArray();

    expect(names(await user.projectsByRole().toArray())).toEqual(["Apollo", "Cygnus"]);
    expect(names(preloaded!.loaded("projectsByRole"))).toEqual(["Apollo", "Cygnus"]);
  });

  test("applies its source's scope and its own", async () => {
    await harness.exec("UPDATE projects SET archived = 1 WHERE id = 3");
    const user = await db().model(User).find(1);

    expect(names(await user.activeProjects().toArray())).toEqual(["Apollo"]);
    expect(names(await user.unarchivedProjects().toArray())).toEqual(["Apollo"]);
  });

  test("reads each record once, however many join records point at it", async () => {
    await harness.exec(
      "INSERT INTO assignments (id, user_id, project_id, role) VALUES (4, 1, 3, 'reviewer')",
    );
    const user = await db().model(User).find(1);

    expect(names(await user.projects().toArray())).toEqual(["Apollo", "Cygnus"]);
    expect(await user.projects().count()).toBe(2);
  });

  test("keeps what it read loaded, until it's read again", async () => {
    const user = await db().model(User).find(1);
    expect(user.isLoaded("projects")).toBe(false);
    await user.projects().toArray();
    await harness.exec(
      "INSERT INTO assignments (id, user_id, project_id, role) VALUES (4, 1, 2, 'member')",
    );
    queries.length = 0;

    expect(names(await user.projects().toArray())).toEqual(["Apollo", "Cygnus"]);
    expect(names(user.loaded("projects"))).toEqual(["Apollo", "Cygnus"]);
    expect(queries).toHaveLength(0);
    expect(names(await user.reloadAssociation("projects"))).toEqual([
      "Apollo",
      "Borealis",
      "Cygnus",
    ]);
    expect(names(user.loaded("projects"))).toEqual(["Apollo", "Borealis", "Cygnus"]);
  });

  describe("declared wrongly, it's an InvalidModel at first use", () => {
    test.each([
      ["NoVia", 'through "missing" isn\'t an association of'],
      ["NoSource", 'Assignment has no association "task" or "tasks"; pass source'],
      ["NoNamedSource", 'Assignment has no association "missing" (check source)'],
      ["OtherTarget", "its source Assignment.project points at Project, not Assignment"],
      ["ThroughItself", "goes through itself"],
      ["Circular", "goes through itself"],
      ["BelongsToThrough", "a belongsTo can't go through another association"],
      ["OneOfMany", "a hasOne can't go through a hasMany (assignments)"],
      [
        "Dependent",
        'a through association\'s dependent is "destroy" or "deleteAll", not "nullify"',
      ],
      ["OneDependent", "a hasOne through another takes no dependent"],
      [
        "DependentThroughHasOne",
        "its dependent needs a join Model: it goes through DependentThroughHasOne.profile, a hasOne",
      ],
      [
        "DependentNested",
        "its dependent needs a join Model: it goes through DependentNested.projects, which goes through another",
      ],
      ["Autosaved", "takes no autosave"],
      ["Keyed", "takes no foreignKey or primaryKey"],
    ] as const)("%s", (name, message) => {
      expect(() => db().model(misdeclared[name])).toThrow(InvalidModel);
      expect(() => db().model(misdeclared[name])).toThrow(message);
    });
  });

  describe("its shapes", () => {
    beforeEach(async () => {
      await harness.exec(
        "INSERT INTO posts (id, user_id, title) VALUES (1, 1, 'First'), (2, 1, 'Second'), (3, 2, 'Other')",
      );
      await harness.exec(
        "INSERT INTO comments (id, post_id, body) VALUES (1, 2, 'Nice'), (2, 1, 'Hello'), (3, 3, 'Elsewhere')",
      );
      await harness.exec(
        "INSERT INTO profiles (id, user_id, bio) VALUES (1, 1, 'Ada'), (2, 2, 'Bo')",
      );
    });

    test("a source that's a hasMany, found by its plural name", async () => {
      const user = await db().model(User).find(1);

      const bodies = (await user.comments().toArray()).map((comment) => comment.body);
      expect(bodies).toEqual(["Nice", "Hello"]);
    });

    test("through a belongsTo, read again when its foreign key changes", async () => {
      const assignment = await db().model(Assignment).find(1);
      const ids = async () => (await assignment.teammates().toArray()).map((each) => each.id);

      expect(await ids()).toEqual([1]);
      assignment.projectId = 2;
      expect(assignment.isLoaded("teammates")).toBe(false);
      expect(await ids()).toEqual([3]);
    });

    test("through a hasOne, lazily and preloaded", async () => {
      const user = await db().model(User).find(1);
      const [preloaded] = await db()
        .model(User)
        .includes("profilePosts", "self")
        .where({ id: 1 })
        .toArray();
      const titles = (posts: readonly Post[]) => posts.map((post) => post.title);

      expect(titles(await user.profilePosts().toArray())).toEqual(["First", "Second"]);
      expect(titles(preloaded!.loaded("profilePosts"))).toEqual(["First", "Second"]);
      expect((await user.self())?.email).toBe("a@example.com");
      expect(preloaded!.loaded("self")?.email).toBe("a@example.com");
    });

    test("a hasOne through a belongsTo", async () => {
      const post = await db().model(Post).find(3);

      expect((await post.authorProfile())?.bio).toBe("Bo");
      expect(post.loaded("authorProfile")?.bio).toBe("Bo");
    });
  });

  describe("nested", () => {
    beforeEach(async () => {
      await harness.exec("INSERT INTO users (id, email) VALUES (3, 'c@example.com')");
      await harness.exec(
        "INSERT INTO assignments (id, user_id, project_id, role) VALUES (4, 2, 1, 'member'), (5, 3, 2, 'member')",
      );
    });
    const ids = (records: readonly { id: number }[]) => records.map((record) => record.id);

    test("through an association that goes through another", async () => {
      const user = await db().model(User).find(1);

      expect(ids(await user.coworkerAssignments().toArray())).toEqual([1, 2, 4]);
    });

    test("to a source that goes through another", async () => {
      const assignment = await db().model(Assignment).find(2);

      expect(ids(await assignment.teamUsers().toArray())).toEqual([1, 2]);
    });

    test("both, at every level", async () => {
      const user = await db().model(User).find(1);

      expect(ids(await user.collaborators().toArray())).toEqual([1, 2]);
      expect(ids(await user.teammates().toArray())).toEqual([1, 2]);
      expect(await user.collaborators().where({ email: "b@example.com" }).count()).toBe(1);
    });
  });

  describe("inserting through it, which it refuses", () => {
    // Its type has no writes; cast to reach the runtime refusals.
    const asCollection = (projects: unknown) => projects as HasManyCollection<Project>;
    const counts = async () => [
      await db().model(Project).count(),
      await db().model(Assignment).count(),
      await db().model(Project).where({ archived: 1 }).count(),
    ];
    const refused =
      "Can't insert or upsert through User.projects: a bulk write makes no join records";
    const writes = {
      insert: (user: User) => asCollection(user.projects()).insert({ name: "New" }),
      insertAll: (user: User) => asCollection(user.projects()).insertAll([{ name: "New" }]),
      upsert: (user: User) => asCollection(user.projects()).upsert({ id: 9, name: "New" }),
      upsertAll: (user: User) => asCollection(user.projects()).upsertAll([{ id: 9, name: "New" }]),
      "a batch's insert": (user: User) =>
        db().batch((b) => [b.insert(asCollection(user.projects()), { name: "New" })]),
    };

    test.each(Object.keys(writes) as (keyof typeof writes)[])(
      "%s throws ReadonlyAssociation, writing nothing",
      async (write) => {
        const user = await db().model(User).find(1);
        const before = await counts();

        await expect(async () => writes[write](user)).rejects.toThrow(ReadonlyAssociation);
        await expect(async () => writes[write](user)).rejects.toThrow(refused);
        expect(await counts()).toEqual(before);
      },
    );

    test.each([
      [
        "one going through another that goes through another",
        (user: User) => user.collaborators().build(),
        "Can't write through User.collaborators: it goes through User.projects, which goes through another",
      ],
      [
        "one whose source goes through another",
        (user: User) => user.teammates().build(),
        "Can't write through User.teammates: its source Assignment.teamUsers goes through another",
      ],
      [
        "one whose source is a hasMany",
        (user: User) => user.comments().build(),
        "Can't write through User.comments: its source Post.comments is a hasMany, not a belongsTo",
      ],
      [
        "a hasMany going through a hasOne",
        (user: User) => user.selves().build(),
        "Can't write through User.selves: it goes through User.profile, a hasOne",
      ],
    ] as const)("%s throws ReadonlyAssociation, saying why", (_, write, message) => {
      const user = db().model(User).build({ email: "new@example.com" });

      expect(() => write(user)).toThrow(ReadonlyAssociation);
      expect(() => write(user)).toThrow(message);
    });

    test("every write through one it can't write through throws, writing nothing", async () => {
      const user = await db().model(User).find(1);
      const comment = db().model(Comment).build();
      const before = await db().model(Comment).count();

      await expect(user.comments().create()).rejects.toThrow(ReadonlyAssociation);
      await expect(user.comments().push(comment)).rejects.toThrow(ReadonlyAssociation);
      await expect(user.comments().delete(comment)).rejects.toThrow(ReadonlyAssociation);
      await expect(user.comments().destroy(comment)).rejects.toThrow(ReadonlyAssociation);
      await expect(user.comments().clear()).rejects.toThrow(ReadonlyAssociation);
      await expect(user.comments().deleteAll()).rejects.toThrow(ReadonlyAssociation);
      expect(await db().model(Comment).count()).toBe(before);
    });

    test("a hasOne going through a belongsTo refuses set", async () => {
      await harness.exec("INSERT INTO posts (id, user_id, title) VALUES (1, 1, 'First')");
      const post = await db().model(Post).find(1);
      const profile = db().model(Profile).build({ userId: 1 });

      await expect(post.authorProfile.set(profile)).rejects.toThrow(
        "Can't write through Post.authorProfile: it goes through Post.user, a belongsTo",
      );
      expect(await db().model(Profile).count()).toBe(0);
    });

    test("updateAll changes its records, as any Relation's", async () => {
      const user = await db().model(User).find(1);

      expect(await user.projects().updateAll({ archived: 1 })).toBe(2);
      expect(await db().model(Project).where({ archived: 1 }).pluck("name")).toEqual([
        "Apollo",
        "Cygnus",
      ]);
    });

    test("an unsaved owner refuses with ReadonlyAssociation as a saved one does", async () => {
      const user = db().model(User).build({ email: "new@example.com" });

      await expect(asCollection(user.projects()).insert({ name: "New" })).rejects.toThrow(
        ReadonlyAssociation,
      );
    });

    test("a Relation it's merged into builds records from its own conditions", async () => {
      const user = await db().model(User).find(1);

      const project = db().model(Project).where({ name: "New" }).merge(user.projects()).build();

      expect(project.name).toBe("New");
    });

    test("deleteBy deletes the records it matches, as a narrowed deleteAll does", async () => {
      const user = await db().model(User).find(1);

      expect(await user.coworkerAssignments().deleteBy({ role: "member" })).toBe(1);
      expect(await db().model(Assignment).pluck("id")).toEqual([1, 3]);
    });

    test("destroyBy destroys the records it matches, as any narrowed Relation's", async () => {
      const user = await db().model(User).find(1);

      const destroyed = await user.coworkerAssignments().destroyBy({ role: "member" });

      expect(destroyed.map((assignment) => assignment.id)).toEqual([2]);
      expect(await db().model(Assignment).pluck("id")).toEqual([1, 3]);
    });

    test("a narrowed deleteAll deletes its records, as any Relation's", async () => {
      const user = await db().model(User).find(1);

      expect(await user.coworkerAssignments().where({ role: "member" }).deleteAll()).toBe(1);
      expect(await db().model(Assignment).pluck("id")).toEqual([1, 3]);
    });
  });
});
