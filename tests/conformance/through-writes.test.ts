import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { belongsTo, hasMany, Model } from "../../packages/active-record/src/index.ts";
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";

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
}

class User extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
}) {
  static table = "users";

  assignments = hasMany(Assignment);
  projects = hasMany(Project, { through: "assignments" });
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
});
