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
  });
});
