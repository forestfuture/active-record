import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { Model } from "../../packages/active-record/src/index.ts";
import { openHarness, type Harness } from "../support/harness.ts";

class User extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  role: "string",
  age: "integer",
  createdAt: "datetime",
  updatedAt: "datetime",
}) {
  static table = "users";
}

const past = new Date("2020-01-01T00:00:00.000Z");
const later = new Date("2021-01-01T00:00:00.000Z");

describe("an upsert's updatedAt on a clash (#36)", () => {
  let harness: Harness;
  const users = () => harness.connect().model(User);
  const updatedAt = async () => (await users().find(1)).updatedAt;

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("users");
    await users().insert({
      id: 1,
      email: "a@example.com",
      role: "member",
      age: 30,
      createdAt: past,
      updatedAt: past,
    });
  });

  test("is kept when no updated value changes", async () => {
    await users().upsertAll([
      { id: 1, email: "a@example.com", role: "member", age: 30 },
      { id: 2, email: "b@example.com", role: "member", age: null },
    ]);

    expect(await updatedAt()).toEqual(past);
  });

  test("is kept when a NULL stays NULL", async () => {
    await users().updateAll({ age: null });

    await users().upsert({ id: 1, email: "a@example.com", age: null });

    expect(await updatedAt()).toEqual(past);
  });

  test("is set when an updated value changes", async () => {
    const before = Date.now();

    await users().upsert({ id: 1, email: "a@example.com", role: "member", age: null });

    expect((await updatedAt())!.getTime()).toBeGreaterThanOrEqual(before);
  });

  test("is kept when only attributes updateOnly leaves out change", async () => {
    await users().upsert(
      { id: 1, email: "a@example.com", role: "member", age: 31 },
      { updateOnly: ["role"] },
    );

    expect(await updatedAt()).toEqual(past);
  });

  test("is written as given when the row gives it", async () => {
    await users().upsert({ id: 1, email: "a@example.com", role: "member", updatedAt: later });

    expect(await updatedAt()).toEqual(later);
  });

  test("given but left out of updateOnly, is written only when a named attribute changes", async () => {
    const row = { id: 1, email: "a@example.com", role: "member", updatedAt: later };

    await users().upsert(row, { updateOnly: ["role"] });
    const kept = await updatedAt();
    await users().upsert({ ...row, role: "admin" }, { updateOnly: ["role"] });

    expect(kept).toEqual(past);
    expect(await updatedAt()).toEqual(later);
  });

  test("with nothing to update, leaves a clashing row alone, uncounted and unreturned", async () => {
    const result = await users().upsert({ email: "a@example.com" }, { uniqueBy: "email" });

    expect(result).toEqual({ rowsAffected: 0, rows: [] });
    expect(await updatedAt()).toEqual(past);
  });
});
