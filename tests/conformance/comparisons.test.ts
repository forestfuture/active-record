import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { between, gt, gte, lt, lte, Model } from "../../packages/active-record/src/index.ts";
import { User } from "../fixtures/models/user.ts";
import { openHarness, type Harness } from "../support/harness.ts";

class Sample extends Model.define({
  id: { type: "integer", null: false },
  settings: "json",
}) {
  static table = "samples";
}

const day = (n: number) => new Date(Date.UTC(2026, 0, n));

describe("comparison conditions", () => {
  let harness: Harness;
  const ids = async (relation: { pluck(attribute: "id"): Promise<number[]> }) =>
    (await relation.pluck("id")).sort((a, b) => a - b);

  beforeAll(async () => {
    harness = await openHarness();
    const users = harness.connect().model(User);
    for (const [id, age, created] of [
      [1, 12, 1],
      [2, 18, 2],
      [3, 30, 3],
      [4, null, 4],
    ] as const) {
      await users.insert({ id, email: `u${id}@example.com`, age, createdAt: day(created) });
    }
  });
  afterAll(() => harness.dispose());

  test("gt, gte, lt and lte compare an attribute with a value", async () => {
    const users = harness.connect().model(User);

    expect(await ids(users.where({ age: gt(18) }))).toEqual([3]);
    expect(await ids(users.where({ age: gte(18) }))).toEqual([2, 3]);
    expect(await ids(users.where({ age: lt(18) }))).toEqual([1]);
    expect(await ids(users.where({ age: lte(18) }))).toEqual([1, 2]);
  });

  test("between includes both ends, like a Rails a..b range; excludeEnd is a...b", async () => {
    const users = harness.connect().model(User);

    expect(await ids(users.where({ age: between(12, 18) }))).toEqual([1, 2]);
    expect(await ids(users.where({ age: between(12, 18, { excludeEnd: true }) }))).toEqual([1]);
  });

  test("datetime attributes compare by time", async () => {
    const users = harness.connect().model(User);

    expect(await ids(users.where({ createdAt: gte(day(3)) }))).toEqual([3, 4]);
    expect(
      await ids(users.where({ createdAt: between(day(1), day(3), { excludeEnd: true }) })),
    ).toEqual([1, 2]);
  });

  test("comparisons combine with other conditions, and whereNot follows SQL's NULL rules", async () => {
    const users = harness.connect().model(User);

    expect(await ids(users.where({ age: gte(12) }).where({ age: lt(30) }))).toEqual([1, 2]);
    expect(await ids(users.where({ age: gt(10), id: [1, 3] }))).toEqual([1, 3]);
    expect(await ids(users.where({ age: lt(18) }).or(users.where({ age: null })))).toEqual([1, 4]);
    // NOT (age >= 18) is NULL for a NULL age, so that row is excluded too.
    expect(await ids(users.whereNot({ age: gte(18) }))).toEqual([1]);
  });

  test("a comparison needs a value: null and undefined throw TypeError", () => {
    expect(() => gt(null as never)).toThrow(TypeError);
    expect(() => lte(undefined as never)).toThrow(TypeError);
    expect(() => between(1, null as never)).toThrow(TypeError);
  });

  test("a record built from a Relation doesn't take a comparison's value", () => {
    const user = harness
      .connect()
      .model(User)
      .where({ age: gte(18) })
      .build();

    expect(user.age).toBeNull();
  });

  test("boolean and json attributes can't be compared: TypeError when written", () => {
    const samples = harness.connect().model(Sample);

    expect(() => samples.where({ settings: gt(1) })).toThrow(TypeError);
  });

  test("a json attribute's object value is still compared for equality", async () => {
    const samples = harness.connect().model(Sample);
    await samples.insert({ id: 1, settings: { gt: 1 } });

    expect(await samples.where({ settings: { gt: 1 } }).pluck("id")).toEqual([1]);
  });
});
