import { afterAll, afterEach, beforeAll, describe, expect, test } from "vite-plus/test";
import { Model } from "../../packages/active-record/src/index.ts";
import { connect } from "../../packages/active-record/src/adapters/d1/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

// Datetime text other tools leave in a SQLite DATETIME column. The rest are in tests/conformance.
class Event extends Model.define({
  id: { type: "integer", null: false },
  name: "string",
  happenedAt: { type: "datetime", column: "happened_at" },
}) {
  static table = "events";
}

describe("datetime text stored by other tools (#73)", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;
  const zone = process.env.TZ;

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
    await binding
      .prepare(
        "CREATE TABLE events (id INTEGER PRIMARY KEY, name TEXT, happened_at DATETIME DEFAULT CURRENT_TIMESTAMP)",
      )
      .run();
  });
  afterAll(() => dispose());
  afterEach(async () => {
    await binding.prepare("DELETE FROM events").run();
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  });

  test("SQLite's own date text (DEFAULT CURRENT_TIMESTAMP) reads as UTC, in any time zone", async () => {
    process.env.TZ = "America/Los_Angeles";
    await binding.prepare("INSERT INTO events (id, name) VALUES (1, 'defaulted')").run();
    await binding
      .prepare("UPDATE events SET happened_at = '2026-10-12 06:38:30.250' WHERE id = 1")
      .run();

    const [event] = await connect(binding).model(Event).toArray();

    expect(event?.happenedAt?.toISOString()).toBe("2026-10-12T06:38:30.250Z");
  });

  test("Prisma's ISO text with an offset reads as it is, in any time zone", async () => {
    process.env.TZ = "America/Los_Angeles";
    await binding
      .prepare("INSERT INTO events (id, name, happened_at) VALUES (1, 'a', ?)")
      .bind("2026-10-12T06:38:30.325+00:00")
      .run();

    const [event] = await connect(binding).model(Event).toArray();

    expect(event?.happenedAt?.toISOString()).toBe("2026-10-12T06:38:30.325Z");
  });
});

// A Unix time column holding what SQLite's loose typing lets in: text, or a fraction. A database
// with strict types can't store these, so they're D1's own (the rest are in tests/conformance).
class Stamp extends Model.define({
  id: { type: "integer", null: false },
  name: "string",
  seconds: { type: "datetime", storage: "unixSeconds" },
  milliseconds: { type: "datetime", storage: "unixMilliseconds" },
}) {
  static table = "stamps";
}

describe("Unix time cells SQLite's loose typing lets in (#73)", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
    await binding
      .prepare(
        "CREATE TABLE stamps (id INTEGER PRIMARY KEY, name TEXT, seconds INTEGER, milliseconds INTEGER)",
      )
      .run();
  });
  afterAll(() => dispose());
  afterEach(async () => {
    await binding.prepare("DELETE FROM stamps").run();
  });

  test("a cell that isn't a Unix time fails when the record loads, naming the attribute", async () => {
    await binding.prepare("INSERT INTO stamps VALUES (1, 'a', 'abc', NULL)").run();

    await expect(connect(binding).model(Stamp).find(1)).rejects.toThrow(
      new TypeError('Stamp: "abc" isn\'t a datetime for "seconds"'),
    );
  });

  test("pluck names a cell that isn't a Unix time, as a record load does", async () => {
    await binding.prepare("INSERT INTO stamps VALUES (1, 'a', 'abc', NULL)").run();

    await expect(connect(binding).model(Stamp).pluck("seconds")).rejects.toThrow(
      new TypeError('Stamp: "abc" isn\'t a datetime for "seconds"'),
    );
  });

  test("a fractional cell loads clean, and saving another attribute leaves it as it was", async () => {
    await binding.prepare("INSERT INTO stamps VALUES (1, 'a', 1767323045.9, NULL)").run();
    const stamp = await connect(binding).model(Stamp).find(1);

    expect(stamp.isChanged()).toBe(false);
    await stamp.update({ name: "b" });

    const { results } = await binding.prepare("SELECT * FROM stamps").all();
    expect(results).toMatchObject([{ name: "b", seconds: 1767323045.9 }]);
  });
});
