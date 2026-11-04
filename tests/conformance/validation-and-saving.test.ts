import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { ActiveRecordError, Model, RecordInvalid } from "../../packages/active-record/src/index.ts";
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";

class User extends Model.define({
  id: { type: "integer", null: false },
  email: "string",
  role: "string",
}) {
  static table = "users";

  static {
    this.validates("email", { presence: true });
  }
}

class Signup extends Model.define({
  id: { type: "integer", null: false },
  email: "string",
}) {
  static table = "users";

  static {
    this.errorMessages({ attributes: { email: { taken: "is already registered" } } });
    this.humanAttributeNames({ email: "Email address" });
    this.validates("email", { uniqueness: true });
  }
}

describe("validation when saving", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.exec("DELETE FROM users");
  });

  test("saving an invalid record returns false and sends no statement", async () => {
    const queries: QueryEvent[] = [];
    const user = harness
      .connect({ onQuery: (event) => queries.push(event) })
      .model(User)
      .build({ role: "admin" });

    expect(await user.save()).toBe(false);

    expect(queries).toHaveLength(0);
    expect(user.isNewRecord()).toBe(true);
    expect(user.errors.get("email")).toEqual(["can't be blank"]);
    expect(user.changes()).toEqual({ role: [null, "admin"] });
  });

  test("saveOrThrow and createOrThrow throw RecordInvalid carrying the record", async () => {
    const users = harness.connect().model(User);
    const user = users.build();

    const error = await user.saveOrThrow().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RecordInvalid);
    expect(error).toBeInstanceOf(ActiveRecordError);
    expect((error as RecordInvalid).record).toBe(user);
    expect((error as Error).message).toMatch(/Email can't be blank/);
    await expect(users.createOrThrow({})).rejects.toThrow(RecordInvalid);
    const saved = await users.create({ email: "a@example.com" });
    await expect(saved.updateOrThrow({ email: " " })).rejects.toThrow(RecordInvalid);
  });

  test("create returns an invalid record unsaved, with its errors", async () => {
    const users = harness.connect().model(User);

    const user = await users.create({ role: "admin" });

    expect(user.isNewRecord()).toBe(true);
    expect(user.errors.size).toBe(1);
    expect(await users.count()).toBe(0);
  });

  test("an invalid update returns false, writes nothing and keeps the changes", async () => {
    const users = harness.connect().model(User);
    const user = await users.create({ email: "a@example.com" });

    expect(await user.update({ email: " " })).toBe(false);

    expect(user.changes()).toEqual({ email: ["a@example.com", " "] });
    expect((await users.find(user.id)).email).toBe("a@example.com");
  });

  test("a uniqueness failure reads the Model's message, and RecordInvalid says it (#88)", async () => {
    const signups = harness.connect().model(Signup);
    await signups.create({ email: "a@example.com" });

    const error = await signups.createOrThrow({ email: "a@example.com" }).catch((caught) => caught);

    expect((error as Error).message).toBe("Validation failed: Email address is already registered");
  });
});
