import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { belongsTo, hasMany, Model } from "../../../packages/active-record/src/index.ts";
import { connect } from "../../../packages/active-record/src/adapters/d1/index.ts";
import { createTestDatabase, recordingBatches, type TestDatabase } from "../../support/d1.ts";

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

describe("writing through an association through another, on D1", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;
  let recording: ReturnType<typeof recordingBatches>;

  beforeAll(async () => {
    // The fixture schema, then the conformance suite's projects and assignments.
    const schema = ["migrations/db/0001_schema.sql", "sqlite/conformance.sql"].map(
      (file) => new URL(`../../fixtures/${file}`, import.meta.url),
    );
    ({ db: binding, dispose } = await createTestDatabase(schema));
  });
  afterAll(() => dispose());
  beforeEach(async () => {
    await binding.batch([
      binding.prepare("DELETE FROM assignments"),
      binding.prepare("DELETE FROM projects"),
      binding.prepare("DELETE FROM users"),
      binding.prepare("INSERT INTO users (id, email) VALUES (1, 'a@example.com')"),
      binding.prepare("INSERT INTO projects (id, name) VALUES (1, 'Apollo'), (2, 'Borealis')"),
    ]);
    recording = recordingBatches(binding);
  });

  test("push writes every join record in one batch", async () => {
    const db = connect(recording.binding);
    const user = await db.model(User).find(1);
    const projects = await db.model(Project).find([1, 2]);

    await user.projects().push(...projects);

    expect(recording.batches).toEqual([2]);
  });

  test("create writes the record and its join record in one batch when its key is given", async () => {
    const db = connect(recording.binding);
    const user = await db.model(User).find(1);

    await user.projects().create({ id: 9, name: "Draco" });

    expect(recording.batches).toEqual([2]);
    expect(await db.model(Assignment).pluck("projectId")).toEqual([9]);
  });
});
