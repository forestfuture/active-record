import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  belongsTo,
  hasMany,
  InvalidModel,
  Model,
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
  Circular: class extends Model.define(userAttributes) {
    static table = "users";
    projects = hasMany(Project, { through: "others" });
    others = hasMany(Project, { through: "projects" });
  },
  Dependent: class extends Model.define(userAttributes) {
    static table = "users";
    assignments = hasMany(Assignment, { foreignKey: "userId" });
    projects = hasMany(Project, { through: "assignments", dependent: "destroy" });
  },
  Autosaved: class extends Model.define(userAttributes) {
    static table = "users";
    assignments = hasMany(Assignment, { foreignKey: "userId" });
    projects = hasMany(Project, { through: "assignments", autosave: true });
  },
  Keyed: class extends Model.define(userAttributes) {
    static table = "users";
    assignments = hasMany(Assignment, { foreignKey: "userId" });
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
      ["Dependent", "takes no dependent"],
      ["Autosaved", "takes no autosave"],
      ["Keyed", "takes no foreignKey or primaryKey"],
    ] as const)("%s", (name, message) => {
      expect(() => db().model(misdeclared[name])).toThrow(InvalidModel);
      expect(() => db().model(misdeclared[name])).toThrow(message);
    });
  });
});
