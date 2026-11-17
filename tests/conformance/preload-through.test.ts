import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { belongsTo, hasMany, hasOne, Model } from "../../packages/active-record/src/index.ts";
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";

class Project extends Model.define({
  id: { type: "integer", null: false },
  name: { type: "string", null: false },
  archived: { type: "integer", null: false },
}) {
  static table = "projects";

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
}

class User extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
}) {
  static table = "users";

  assignments = hasMany(Assignment);
  projects = hasMany(Project, { through: "assignments" });
  collaborators = hasMany(User, { through: "projects", source: "members" });
  profile = hasOne(Profile);
}

class Profile extends Model.define({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  bio: "string",
}) {
  static table = "profiles";

  user = belongsTo(User);
  firstProject = hasOne(Project, { through: "user", source: "projects" });
}

describe("preloading an association through another", () => {
  let harness: Harness;
  let database: ReturnType<Harness["connect"]>;
  const queries: QueryEvent[] = [];
  const db = () => database;
  const names = (records: readonly { name: string }[]) => records.map((record) => record.name);

  beforeAll(async () => {
    harness = await openHarness();
    database = harness.connect({ onQuery: (event) => void queries.push(event) });
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("assignments", "projects", "profiles", "comments", "posts", "users");
    await harness.exec(
      "INSERT INTO users (id, email) VALUES (1, 'a@example.com'), (2, 'b@example.com'), (3, 'c@example.com')",
    );
    await harness.exec(
      "INSERT INTO projects (id, name) VALUES (1, 'Apollo'), (2, 'Borealis'), (3, 'Cygnus')",
    );
    await harness.exec(
      "INSERT INTO assignments (id, user_id, project_id, role) VALUES (1, 1, 3, 'lead'), (2, 1, 1, 'member'), (3, 2, 2, 'lead'), (4, 1, 3, 'reviewer')",
    );
    queries.length = 0;
  });

  test("loads each owner's records with a query per hop, and reads them without one", async () => {
    const users = await db().model(User).includes("projects").order({ id: "asc" }).toArray();

    expect(queries).toHaveLength(3);
    queries.length = 0;
    expect(names(users[0]!.loaded("projects"))).toEqual(["Apollo", "Cygnus"]);
    expect(names(users[1]!.loaded("projects"))).toEqual(["Borealis"]);
    expect(users[2]!.loaded("projects")).toEqual([]);
    expect(names(await users[0]!.projects().toArray())).toEqual(["Apollo", "Cygnus"]);
    expect(queries).toHaveLength(0);
  });
});
