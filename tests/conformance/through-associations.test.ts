import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  belongsTo,
  hasMany,
  Model,
  RecordNotFound,
} from "../../packages/active-record/src/index.ts";
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
  leads = hasMany(Assignment, { scope: (q) => q.where({ role: "lead" }) });
  ledProjects = hasMany(Project, { through: "leads", source: "project" });
  activeProjects = hasMany(Project, { through: "assignments", source: "activeProject" });
  unarchivedProjects = hasMany(Project, {
    through: "assignments",
    source: "project",
    scope: (q) => q.where({ archived: 0 }),
  });
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
});
