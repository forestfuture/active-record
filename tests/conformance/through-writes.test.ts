import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  abort,
  belongsTo,
  hasMany,
  Model,
  RecordInvalid,
  RecordNotDestroyed,
  RecordNotSaved,
} from "../../packages/active-record/src/index.ts";
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";
import { statementKinds } from "../support/statement-kinds.ts";

class Project extends Model.define({
  id: { type: "integer", null: false },
  name: { type: "string", null: false },
  archived: { type: "integer", null: false },
}) {
  static table = "projects";

  static {
    this.validates("name", { presence: true });
  }
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

  static {
    this.beforeDestroy((assignment) => {
      if (assignment.role === "keep") throw abort("this assignment is kept");
    });
    this.afterDestroy((assignment) => void destroyed.push(assignment.id));
  }
}

const userAttributes = {
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
} as const;

/** Users whose projects' join records go as their `dependent:` says. */
class DestroyingUser extends Model.define(userAttributes) {
  static table = "users";

  assignments = hasMany(Assignment, { foreignKey: "userId" });
  projects = hasMany(Project, { through: "assignments", dependent: "destroy" });
}

class DeletingUser extends Model.define(userAttributes) {
  static table = "users";

  assignments = hasMany(Assignment, { foreignKey: "userId" });
  projects = hasMany(Project, { through: "assignments", dependent: "deleteAll" });
}

/** The ids of the assignments destroyed, in turn. */
const destroyed: number[] = [];

class User extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
}) {
  static table = "users";

  assignments = hasMany(Assignment);
  projects = hasMany(Project, { through: "assignments" });
  archivedProjects = hasMany(Project, {
    through: "assignments",
    source: "project",
    scope: (q) => q.where({ archived: 1 }),
  });
  leads = hasMany(Assignment, { scope: (q) => q.where({ role: "lead" }) });
  ledProjects = hasMany(Project, { through: "leads", source: "project" });
}

describe("writing through an association through another", () => {
  let harness: Harness;
  let database: ReturnType<Harness["connect"]>;
  const queries: QueryEvent[] = [];
  const db = () => database;
  /** Each assignment, as `[userId, projectId]`, in the order they were written. */
  const links = async () =>
    (await db().model(Assignment).order({ id: "asc" }).toArray()).map((each) => [
      each.userId,
      each.projectId,
    ]);

  beforeAll(async () => {
    harness = await openHarness();
    database = harness.connect({ onQuery: (event) => void queries.push(event) });
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("assignments", "projects", "users");
    await harness.exec(
      "INSERT INTO users (id, email) VALUES (1, 'a@example.com'), (2, 'b@example.com')",
    );
    await harness.exec(
      "INSERT INTO projects (id, name) VALUES (1, 'Apollo'), (2, 'Borealis'), (3, 'Cygnus')",
    );
    await harness.exec(
      "INSERT INTO assignments (id, user_id, project_id, role) VALUES (1, 1, 1, 'lead'), (2, 2, 2, 'lead')",
    );
    queries.length = 0;
    destroyed.length = 0;
  });

  describe("push", () => {
    test("creates a join record linking the owner to each record", async () => {
      const user = await db().model(User).find(1);
      const [borealis, cygnus] = await db().model(Project).find([2, 3]);

      expect(await user.projects().push(borealis!, cygnus!)).toBe(true);

      expect(await links()).toEqual([
        [1, 1],
        [2, 2],
        [1, 2],
        [1, 3],
      ]);
      expect(await user.projects().pluck("name")).toEqual(["Apollo", "Borealis", "Cygnus"]);
    });

    test("saves a new record first, then its join record", async () => {
      const user = await db().model(User).find(1);
      const draco = db().model(Project).build({ name: "Draco" });

      expect(await user.projects().push(draco)).toBe(true);

      expect(draco.isPersisted()).toBe(true);
      expect(await links()).toEqual([
        [1, 1],
        [2, 2],
        [1, draco.id],
      ]);
    });

    test("adds the records to what the owner has loaded, and their join records", async () => {
      const user = await db().model(User).find(1);
      await user.projects().toArray();
      await user.assignments().toArray();
      const cygnus = await db().model(Project).find(3);

      await user.projects().push(cygnus);

      expect(user.loaded("projects").map((project) => project.name)).toEqual(["Apollo", "Cygnus"]);
      expect(user.loaded("assignments").map((each) => each.projectId)).toEqual([1, 3]);
    });

    test("throws TypeError for a record of another Model, writing nothing", async () => {
      const user = await db().model(User).find(1);
      const other = await db().model(User).find(2);

      await expect(user.projects().push(other as never)).rejects.toThrow(TypeError);
      expect(await links()).toEqual([
        [1, 1],
        [2, 2],
      ]);
    });

    test("resolves to false, writing nothing, when a record can't be saved", async () => {
      const user = await db().model(User).find(1);
      const cygnus = await db().model(Project).find(3);
      const invalid = db().model(Project).build({ name: "" });

      expect(await user.projects().push(cygnus, invalid)).toBe(false);
      // Nothing is left to save with the owner later.
      expect(await user.save()).toBe(true);

      expect(await links()).toEqual([
        [1, 1],
        [2, 2],
      ]);
      expect(await db().model(Project).count()).toBe(3);
    });

    test("on a new owner, holds the records until the owner is saved", async () => {
      const user = db().model(User).build({ email: "c@example.com" });
      const cygnus = await db().model(Project).find(3);
      const draco = db().model(Project).build({ name: "Draco" });

      expect(await user.projects().push(cygnus, draco)).toBe(true);

      expect(await links()).toEqual([
        [1, 1],
        [2, 2],
      ]);
      expect((await user.projects().toArray()).map((project) => project.name)).toEqual([
        "Cygnus",
        "Draco",
      ]);
      expect(await user.save()).toBe(true);
      expect(await links()).toEqual([
        [1, 1],
        [2, 2],
        [user.id, 3],
        [user.id, draco.id],
      ]);
    });
  });

  describe("build", () => {
    test("builds a record and its join record, saved with the owner", async () => {
      const user = await db().model(User).find(1);

      const draco = user.projects().build({ name: "Draco" });

      expect(draco.isNewRecord()).toBe(true);
      expect(await links()).toEqual([
        [1, 1],
        [2, 2],
      ]);
      expect(await user.save()).toBe(true);
      expect(await links()).toEqual([
        [1, 1],
        [2, 2],
        [1, draco.id],
      ]);
      expect(await db().model(Project).where({ name: "Draco" }).count()).toBe(1);
    });

    test("saving the record alone writes no join record: the owner's save does", async () => {
      const user = await db().model(User).find(1);
      const draco = user.projects().build({ name: "Draco" });

      expect(await draco.save()).toBe(true);
      expect(await links()).toEqual([
        [1, 1],
        [2, 2],
      ]);

      expect(await user.save()).toBe(true);
      expect(await links()).toEqual([
        [1, 1],
        [2, 2],
        [1, draco.id],
      ]);
    });

    test("on a new owner, saves the record and its join record after it", async () => {
      const user = db().model(User).build({ email: "c@example.com" });

      const draco = user.projects().build({ name: "Draco" });

      expect(await user.save()).toBe(true);
      expect(await links()).toEqual([
        [1, 1],
        [2, 2],
        [user.id, draco.id],
      ]);
    });
  });

  describe("create", () => {
    test("saves the record, then its join record", async () => {
      const user = await db().model(User).find(1);
      queries.length = 0;

      const draco = await user.projects().create({ name: "Draco" });

      expect(draco.isPersisted()).toBe(true);
      expect(statementKinds(queries)).toEqual(["INSERT", "INSERT"]);
      expect(await links()).toEqual([
        [1, 1],
        [2, 2],
        [1, draco.id],
      ]);
    });

    test("an invalid record is returned unsaved, with nothing written", async () => {
      const user = await db().model(User).find(1);

      const project = await user.projects().create({ name: "" });

      expect(project.isNewRecord()).toBe(true);
      expect(project.errors.get("name")).toEqual(["can't be blank"]);
      expect(await user.save()).toBe(true);
      expect(await links()).toEqual([
        [1, 1],
        [2, 2],
      ]);
    });

    test("createOrThrow throws RecordInvalid for the record, writing nothing", async () => {
      const user = await db().model(User).find(1);

      const error = await user
        .projects()
        .createOrThrow({ name: "" })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(RecordInvalid);
      expect((error as RecordInvalid).record).toBeInstanceOf(Project);
      expect(await db().model(Project).count()).toBe(3);
    });

    test("a new owner throws RecordNotSaved, as through a hasMany", async () => {
      const user = db().model(User).build({ email: "c@example.com" });

      await expect(user.projects().create({ name: "Draco" })).rejects.toThrow(RecordNotSaved);
    });
  });

  describe("scopes", () => {
    test("a record takes the equality values of its scope and of a narrowed Relation", async () => {
      const user = await db().model(User).find(1);

      const vega = user.archivedProjects().build({ name: "Vega" });
      const lyra = await user.projects().where({ archived: 1 }).create({ name: "Lyra" });

      expect(vega.archived).toBe(1);
      expect(lyra.archived).toBe(1);
      expect(await links()).toEqual([
        [1, 1],
        [2, 2],
        [1, lyra.id],
      ]);
    });

    test("a join record takes the equality values of the association it's built through", async () => {
      const user = await db().model(User).find(1);
      const cygnus = await db().model(Project).find(3);

      await user.ledProjects().push(cygnus);

      expect((await db().model(Assignment).findBy({ projectId: 3 }))?.role).toBe("lead");
    });
  });

  describe("delete", () => {
    beforeEach(async () => {
      await harness.exec("INSERT INTO assignments (id, user_id, project_id) VALUES (3, 1, 3)");
    });

    test("deletes the owner's join records to the records, which stay", async () => {
      const user = await db().model(User).find(1);
      await user.projects().toArray();
      const apollo = await db().model(Project).find(1);

      expect(await user.projects().delete(apollo)).toEqual([apollo]);

      expect(await links()).toEqual([
        [2, 2],
        [1, 3],
      ]);
      expect(await db().model(Project).count()).toBe(3);
      expect(user.loaded("projects").map((project) => project.name)).toEqual(["Cygnus"]);
    });

    test("a record built through it leaves, and saving the owner writes neither", async () => {
      const user = await db().model(User).find(1);
      const draco = user.projects().build({ name: "Draco" });

      await user.projects().delete(draco);

      expect(await user.save()).toBe(true);
      expect(await db().model(Project).count()).toBe(3);
      expect((await user.projects().toArray()).map((project) => project.name)).toEqual([
        "Apollo",
        "Cygnus",
      ]);
    });

    test("a record the owner doesn't reach removes nothing", async () => {
      const user = await db().model(User).find(1);
      const borealis = await db().model(Project).find(2);

      expect(await user.projects().delete(borealis)).toEqual([borealis]);

      expect(await links()).toEqual([
        [1, 1],
        [2, 2],
        [1, 3],
      ]);
    });
  });

  describe("destroy", () => {
    beforeEach(async () => {
      await harness.exec("INSERT INTO assignments (id, user_id, project_id) VALUES (3, 1, 3)");
    });

    test("destroys the owner's join records to the records, callbacks included; the records stay", async () => {
      const user = await db().model(User).find(1);
      const [apollo, cygnus] = await db().model(Project).find([1, 3]);

      expect(await user.projects().destroy(apollo!, cygnus!)).toEqual([apollo, cygnus]);

      expect(destroyed).toEqual([1, 3]);
      expect(await links()).toEqual([[2, 2]]);
      expect(await db().model(Project).count()).toBe(3);
      expect(await user.projects().count()).toBe(0);
    });

    test("a join record that refuses throws RecordNotDestroyed, destroying none", async () => {
      await harness.exec("UPDATE assignments SET role = 'keep' WHERE id = 3");
      const user = await db().model(User).find(1);
      const [apollo, cygnus] = await db().model(Project).find([1, 3]);

      await expect(user.projects().destroy(apollo!, cygnus!)).rejects.toThrow(RecordNotDestroyed);

      expect(await links()).toEqual([
        [1, 1],
        [2, 2],
        [1, 3],
      ]);
    });
  });

  describe("clear and the association's own deleteAll", () => {
    beforeEach(async () => {
      await harness.exec(
        "INSERT INTO assignments (id, user_id, project_id) VALUES (3, 1, 3), (4, 2, 3)",
      );
      await harness.exec("UPDATE projects SET archived = 1 WHERE id = 3");
    });

    test("clear deletes the owner's join records, and then it reads as empty", async () => {
      const user = await db().model(User).find(1);
      const draco = user.projects().build({ name: "Draco" });

      await user.projects().clear();

      expect(destroyed).toEqual([]);
      expect(await links()).toEqual([
        [2, 2],
        [2, 3],
      ]);
      expect(await db().model(Project).count()).toBe(3);
      expect(user.loaded("projects")).toEqual([]);
      expect(await user.save()).toBe(true);
      expect(draco.isNewRecord()).toBe(true);
    });

    test("deleteAll deletes the join records to the records it reaches, resolving to how many", async () => {
      const user = await db().model(User).find(1);

      expect(await user.archivedProjects().deleteAll()).toBe(1);

      expect(await links()).toEqual([
        [1, 1],
        [2, 2],
        [2, 3],
      ]);
      expect(await db().model(Project).count()).toBe(3);
    });

    test("a new owner's clear forgets what was built through it, and its deleteAll deletes nothing", async () => {
      await harness.exec("INSERT INTO assignments (id, user_id, project_id) VALUES (5, NULL, 1)");
      const user = db().model(User).build({ email: "c@example.com" });
      user.projects().build({ name: "Draco" });

      await user.projects().clear();
      await user.projects().deleteAll();

      expect(await db().model(Assignment).count()).toBe(5);
      expect(await user.save()).toBe(true);
      expect(await db().model(Assignment).count()).toBe(5);
      expect(await db().model(Project).count()).toBe(3);
    });

    test("a batch's deleteAll of it deletes the owner's join records", async () => {
      const user = await db().model(User).find(1);

      await db().batch((b) => [b.deleteAll(user.projects())]);

      expect(await links()).toEqual([
        [2, 2],
        [2, 3],
      ]);
    });
  });

  describe("dependent", () => {
    beforeEach(async () => {
      await harness.exec("INSERT INTO assignments (id, user_id, project_id) VALUES (3, 1, 3)");
    });

    test('"destroy" makes delete destroy the join records, callbacks included', async () => {
      const user = await db().model(DestroyingUser).find(1);
      const apollo = await db().model(Project).find(1);

      await user.projects().delete(apollo);

      expect(destroyed).toEqual([1]);
      expect(await links()).toEqual([
        [2, 2],
        [1, 3],
      ]);
    });

    test('"destroy" leaves clear deleting the join records without callbacks, as in Rails', async () => {
      const user = await db().model(DestroyingUser).find(1);

      await user.projects().clear();

      expect(destroyed).toEqual([]);
      expect(await links()).toEqual([[2, 2]]);
    });

    test('destroying the owner with "destroy" destroys its join records; the records stay', async () => {
      const user = await db().model(DestroyingUser).find(1);

      expect(await user.destroy()).toBe(user);

      expect(destroyed).toEqual([1, 3]);
      expect(await links()).toEqual([[2, 2]]);
      expect(await db().model(Project).count()).toBe(3);
    });

    test('destroying the owner with "deleteAll" deletes its join records, without callbacks', async () => {
      const user = await db().model(DeletingUser).find(1);

      expect(await user.destroy()).toBe(user);

      expect(destroyed).toEqual([]);
      expect(await links()).toEqual([[2, 2]]);
      expect(await db().model(User).count()).toBe(1);
    });

    test("a join record that refuses stops the owner's destroy", async () => {
      await harness.exec("UPDATE assignments SET role = 'keep' WHERE id = 3");
      const user = await db().model(DestroyingUser).find(1);

      await expect(user.destroy()).rejects.toThrow(RecordNotDestroyed);

      expect(await db().model(User).count()).toBe(2);
      expect(await links()).toEqual([
        [1, 1],
        [2, 2],
        [1, 3],
      ]);
    });
  });
});
