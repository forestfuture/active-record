import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { between, gte, Model } from "../../packages/active-record/src/index.ts";
import { openHarness, type Harness } from "../support/harness.ts";

// Integer epoch columns, as other tools leave them.
// Drizzle's integer({ mode: "timestamp" }) and integer({ mode: "timestamp_ms" }).
class Stamp extends Model.define({
  id: { type: "integer", null: false },
  name: "string",
  seconds: { type: "datetime", storage: "unixSeconds" },
  milliseconds: { type: "datetime", storage: "unixMilliseconds" },
}) {
  static table = "stamps";
}

// created_at and updated_at as integer milliseconds, as Drizzle's timestamp_ms mode writes them.
class Entry extends Model.define({
  id: { type: "integer", null: false },
  title: "string",
  createdAt: { type: "datetime", storage: "unixMilliseconds" },
  updatedAt: { type: "datetime", storage: "unixMilliseconds" },
}) {
  static table = "entries";
}

describe("datetimes stored by other tools (#73)", () => {
  let harness: Harness;
  const zone = process.env.TZ;

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("entries", "stamps");
  });
  afterEach(() => {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  });

  test("an integer column declared with a storage reads as a Date", async () => {
    await harness.exec("INSERT INTO stamps VALUES (1, 'a', 1767323045, 1767323045678)");

    const [stamp] = await harness.connect().model(Stamp).toArray();

    expect(stamp?.seconds?.toISOString()).toBe("2026-01-02T03:04:05.000Z");
    expect(stamp?.milliseconds?.toISOString()).toBe("2026-01-02T03:04:05.678Z");
  });

  // From a form or JSON, so not typed as a Date.
  const untyped = (value: unknown) => value as never;

  // These passed on first run, as the storage rides on the converters, so they guard it; the
  // update test at the end was red (the review of #73).
  const raw = async (table: string) => await harness.exec(`SELECT * FROM ${table} ORDER BY id`);

  test("saving writes the integer, in seconds or milliseconds", async () => {
    const stamps = harness.connect().model(Stamp);

    await stamps.create({
      name: "a",
      seconds: new Date("2026-01-02T03:04:05.678Z"),
      milliseconds: new Date("2026-01-02T03:04:05.678Z"),
    });

    expect(await raw("stamps")).toMatchObject([
      { seconds: 1767323045, milliseconds: 1767323045678 },
    ]);
  });

  test("created_at and updated_at are set as integers", async () => {
    const entries = harness.connect().model(Entry);
    const before = Date.now();

    const entry = await entries.create({ title: "a" });
    const [row] = (await raw("entries")) as { created_at: number; updated_at: number }[];

    expect(row!.created_at).toBeGreaterThanOrEqual(before);
    expect(row!.updated_at).toBe(row!.created_at);
    expect(entry.createdAt?.getTime()).toBe(row!.created_at);

    await entry.update({ title: "b" });
    const [updated] = (await raw("entries")) as { created_at: number; updated_at: number }[];

    expect(updated!.created_at).toBe(row!.created_at);
    expect(updated!.updated_at).toBeGreaterThanOrEqual(row!.updated_at);
  });

  test("conditions on the attribute compare integers, given Dates", async () => {
    await harness.exec("INSERT INTO stamps VALUES (1, 'a', 1767225600, 1767225600000)");
    await harness.exec("INSERT INTO stamps VALUES (2, 'b', 1767312000, 1767312000000)");
    await harness.exec("INSERT INTO stamps VALUES (3, 'c', 1767398400, 1767398400000)");
    const stamps = harness.connect().model(Stamp);
    const names = async (relation: ReturnType<typeof stamps.where>) =>
      (await relation.order({ id: "asc" }).toArray()).map((stamp) => stamp.name);

    const second = new Date("2026-01-02T00:00:00.000Z");
    const third = new Date("2026-01-03T00:00:00.000Z");

    expect(await names(stamps.where({ seconds: second }))).toEqual(["b"]);
    expect(await names(stamps.where({ milliseconds: gte(second) }))).toEqual(["b", "c"]);
    expect(await names(stamps.where({ seconds: between(second, third) }))).toEqual(["b", "c"]);
  });

  test("an ISO string assigned to a stored datetime is cast, and written as an integer", async () => {
    const stamps = harness.connect().model(Stamp);

    await stamps.create({ name: "a", seconds: untyped("2026-01-02T03:04:05Z") });

    expect(await raw("stamps")).toMatchObject([{ seconds: 1767323045 }]);
  });

  test("a value that isn't a datetime is refused with a TypeError", () => {
    expect(() =>
      harness
        .connect()
        .model(Stamp)
        .build({ seconds: untyped("yesterday") }),
    ).toThrow(TypeError);
  });

  test("null is stored as NULL", async () => {
    await harness.connect().model(Stamp).create({ name: "a", seconds: null });

    expect(await raw("stamps")).toMatchObject([{ seconds: null }]);
  });

  test("bulk writes store integers: insertAll, upsertAll and updateAll", async () => {
    const stamps = harness.connect().model(Stamp);
    const at = new Date("2026-01-02T03:04:05.678Z");

    await stamps.insertAll([{ id: 1, name: "a", seconds: at, milliseconds: at }]);
    expect(await raw("stamps")).toMatchObject([
      { seconds: 1767323045, milliseconds: 1767323045678 },
    ]);

    const later = new Date("2026-01-03T00:00:00.000Z");
    await stamps.upsertAll([{ id: 1, name: "b", seconds: later, milliseconds: later }], {
      uniqueBy: "id",
    });
    expect(await raw("stamps")).toMatchObject([
      { seconds: 1767398400, milliseconds: 1767398400000 },
    ]);

    await stamps.updateAll({ seconds: at, milliseconds: at });
    expect(await raw("stamps")).toMatchObject([
      { seconds: 1767323045, milliseconds: 1767323045678 },
    ]);
  });

  test("a datetime's default is written as an integer", async () => {
    class Dated extends Model.define({
      id: { type: "integer", null: false },
      seconds: {
        type: "datetime",
        storage: "unixSeconds",
        default: () => new Date(1_800_000_000_500),
      },
    }) {
      static table = "stamps";
    }

    await harness.connect().model(Dated).create({});

    expect(await raw("stamps")).toMatchObject([{ seconds: 1_800_000_000 }]);
  });

  test("an assignment that stores the same integer isn't a change", async () => {
    await harness.exec("INSERT INTO stamps VALUES (1, 'a', 1767323045, NULL)");
    const [stamp] = await harness.connect().model(Stamp).toArray();

    stamp!.seconds = new Date("2026-01-02T03:04:05.678Z");

    expect(stamp!.isChanged()).toBe(false);
  });

  test("after an insert, the record holds the second that was stored", async () => {
    const stamp = await harness
      .connect()
      .model(Stamp)
      .create({ name: "a", seconds: new Date("2026-01-02T03:04:05.678Z") });

    expect(stamp.seconds?.toISOString()).toBe("2026-01-02T03:04:05.000Z");
  });

  test("after an update, the record holds the second that was stored, as saved changes show", async () => {
    await harness.exec("INSERT INTO stamps VALUES (1, 'a', 1767323045, NULL)");
    const [stamp] = await harness.connect().model(Stamp).toArray();

    stamp!.seconds = new Date("2026-01-02T03:04:06.500Z");
    await stamp!.save();

    expect(stamp!.seconds?.toISOString()).toBe("2026-01-02T03:04:06.000Z");
    expect(stamp!.savedChanges().seconds?.[1]).toEqual(stamp!.seconds);
  });

  test("a cell that isn't a Unix time fails when the record loads, naming the attribute", async () => {
    await harness.exec("INSERT INTO stamps VALUES (1, 'a', 'abc', NULL)");

    await expect(harness.connect().model(Stamp).find(1)).rejects.toThrow(
      new TypeError('Stamp: "abc" isn\'t a datetime for "seconds"'),
    );
  });

  test("a cell past the range of a Date fails the same way, showing the number", async () => {
    await harness.exec("INSERT INTO stamps VALUES (1, 'a', NULL, 9000000000000000000)");

    await expect(harness.connect().model(Stamp).find(1)).rejects.toThrow(
      new TypeError('Stamp: 9000000000000000000 isn\'t a datetime for "milliseconds"'),
    );
  });

  test("a same-second assignment holds the stored second after a save of another attribute (#163)", async () => {
    await harness.exec("INSERT INTO stamps VALUES (1, 'a', 1767323045, NULL)");
    const stamp = await harness.connect().model(Stamp).find(1);

    stamp.seconds = new Date("2026-01-02T03:04:05.678Z");
    stamp.name = "b";
    await stamp.save();

    expect(stamp.seconds?.getTime()).toBe(1767323045000);
  });

  test("pluck names a cell that isn't a Unix time too, as a record load does", async () => {
    await harness.exec("INSERT INTO stamps VALUES (1, 'a', 'abc', NULL)");

    await expect(harness.connect().model(Stamp).pluck("seconds")).rejects.toThrow(
      new TypeError('Stamp: "abc" isn\'t a datetime for "seconds"'),
    );
  });

  test("a fractional cell loads clean, and saving another attribute leaves it as it was", async () => {
    await harness.exec("INSERT INTO stamps VALUES (1, 'a', 1767323045.9, NULL)");
    const stamp = await harness.connect().model(Stamp).find(1);

    expect(stamp.isChanged()).toBe(false);
    await stamp.update({ name: "b" });

    expect(await raw("stamps")).toMatchObject([{ name: "b", seconds: 1767323045.9 }]);
  });
});
