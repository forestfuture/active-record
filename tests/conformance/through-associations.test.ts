import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { belongsTo, hasMany, Model } from "../../packages/active-record/src/index.ts";
import { openHarness, type Harness } from "../support/harness.ts";

class Project extends Model.define({
  id: { type: "integer", null: false },
  name: { type: "string", null: false },
  archived: { type: "integer", null: false },
}) {
  static table = "projects";

  assignments = hasMany(Assignment);
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

describe("an association through another", () => {
  let harness: Harness;
  let database: ReturnType<Harness["connect"]>;
  const db = () => database;
  const names = (projects: readonly Project[]) => projects.map((project) => project.name);

  beforeAll(async () => {
    harness = await openHarness();
    database = harness.connect();
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
});
