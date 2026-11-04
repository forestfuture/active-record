import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  column,
  IncompatibleRelation,
  Model,
  sql,
  UnknownAttribute,
} from "../../packages/active-record/src/index.ts";
import type { AnyDatabase } from "../../packages/active-record/src/database.ts";
import { openHarness, type Harness } from "../support/harness.ts";

// Attributes of every type, to show the value is written as each stores it.
class Sample extends Model.define({
  id: { type: "integer", null: false },
  label: "string",
  enabled: "boolean",
  settings: "json",
  stamp: "datetime",
  secret: "string",
}) {
  static table = "typed_samples";
  static override filterAttributes = ["secret"];
}

// An attribute stored as a Unix time: a plain Date interpolated into a fragment is ISO text.
class Stamp extends Model.define({
  id: { type: "integer", null: false },
  name: "string",
  seconds: { type: "datetime", storage: "unixSeconds" },
  milliseconds: { type: "datetime", storage: "unixMilliseconds" },
}) {
  static table = "stamps";
}

describe("a typed value in an sql fragment (#142)", () => {
  let harness: Harness;
  // One database, since `or` needs its relations on the same one.
  let shared: AnyDatabase;

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    shared = harness.connect();
    await harness.reset("stamps", "typed_samples");
    await harness.exec("INSERT INTO stamps VALUES (1, 'a', 1767225600, 1767225600000)");
    await harness.exec("INSERT INTO stamps VALUES (2, 'b', 1767312000, 1767312000000)");
    await harness.exec("INSERT INTO stamps VALUES (3, 'c', 1767398400, 1767398400000)");
  });

  const stamps = () => shared.model(Stamp).order({ id: "asc" });
  const names = async (relation: { toArray(): Promise<Stamp[]> }) =>
    (await relation.toArray()).map((stamp) => stamp.name ?? "");
  const rawStamps = async () => await harness.exec("SELECT * FROM stamps ORDER BY id");
  const countSamples = (condition: ReturnType<typeof sql>) =>
    shared.model(Sample).where(condition).count();

  const day = new Date("2026-01-02T00:00:00.000Z");

  test("a Date for a unixSeconds attribute compares with its column as an integer", async () => {
    const seconds = column("seconds");

    expect(await names(stamps().where(sql`${seconds} >= ${seconds.value(day)}`))).toEqual([
      "b",
      "c",
    ]);
  });

  test("a Date for a unixMilliseconds attribute compares with its column as an integer", async () => {
    const milliseconds = column("milliseconds");

    expect(await names(stamps().where(sql`${milliseconds} < ${milliseconds.value(day)}`))).toEqual([
      "a",
    ]);
  });

  test("a Date for an ISO datetime is ISO text", async () => {
    await harness.exec(
      "INSERT INTO typed_samples (id, stamp) VALUES (1, '2026-01-02T03:04:05.000Z')",
    );
    const stamp = column("stamp");
    const moment = new Date("2026-01-02T03:04:05.000Z");

    expect(await countSamples(sql`${stamp} = ${stamp.value(moment)}`)).toBe(1);
  });

  test("a boolean's value is 0 or 1, from the forms an assignment accepts", async () => {
    await harness.exec("INSERT INTO typed_samples (id, enabled) VALUES (1, 1)");
    const enabled = column("enabled");

    expect(await countSamples(sql`${enabled} = ${enabled.value("on")}`)).toBe(1);
  });

  test("a json attribute's value is JSON text", async () => {
    await harness.exec(`INSERT INTO typed_samples (id, settings) VALUES (1, '{"theme":"dark"}')`);
    const settings = column("settings");

    expect(await countSamples(sql`${settings} = ${settings.value({ theme: "dark" })}`)).toBe(1);
  });

  test("a value the attribute can't cast throws TypeError naming the Model and attribute, when the fragment is used", () => {
    const seconds = column("seconds");
    const condition = sql`${seconds} > ${seconds.value("yesterday")}`;

    expect(() => stamps().where(condition)).toThrow(
      new TypeError('Stamp: "yesterday" isn\'t a datetime for "seconds"'),
    );
  });

  test("undefined says to use null, as assigning it does (#163)", () => {
    const seconds = column("seconds");
    const condition = sql`${seconds} > ${seconds.value(undefined)}`;

    expect(() => stamps().where(condition)).toThrow(
      new TypeError('Stamp: got undefined for "seconds"; use null to store NULL'),
    );
  });

  test("an attribute the Model doesn't have is UnknownAttribute when the fragment is used", () => {
    // Alone: a column() beside it would already be checked.
    const condition = sql`seconds > ${column("nope").value(1)}`;

    expect(() => stamps().where(condition)).toThrow(UnknownAttribute);
  });

  test("a filtered attribute's value is hidden from onQuery", async () => {
    await harness.exec("INSERT INTO typed_samples (id, secret) VALUES (1, 's3cret')");
    const events: { params: unknown[] }[] = [];
    const samples = harness.connect({ onQuery: (event) => events.push(event) }).model(Sample);
    const secret = column("secret");

    await samples.where(sql`${secret} = ${secret.value("s3cret")}`).count();

    expect(JSON.stringify(events.map((event) => event.params))).not.toContain("s3cret");
    expect(JSON.stringify(events.map((event) => event.params))).toContain("[FILTERED]");
  });

  test("a filtered attribute's value still reaches the database", async () => {
    await harness.exec("INSERT INTO typed_samples (id, secret) VALUES (1, 's3cret')");
    const secret = column("secret");

    expect(await countSamples(sql`${secret} = ${secret.value("s3cret")}`)).toBe(1);
  });

  test("updateAll writes the stored form", async () => {
    const milliseconds = column("milliseconds");
    const moment = new Date("2026-02-03T04:05:06.789Z");

    await stamps().updateAll(sql`${milliseconds} = ${milliseconds.value(moment)}`);

    expect(await rawStamps()).toMatchObject([
      { milliseconds: moment.getTime() },
      { milliseconds: moment.getTime() },
      { milliseconds: moment.getTime() },
    ]);
  });

  test("an order fragment sorts by the stored form", async () => {
    const milliseconds = column("milliseconds");
    const third = new Date("2026-01-03T00:00:00.000Z");

    const nearest = stamps().reorder(sql`abs(${milliseconds} - ${milliseconds.value(third)})`);

    expect(await names(nearest)).toEqual(["c", "b", "a"]);
  });

  test("toSql shows the stored form as the parameter", () => {
    const milliseconds = column("milliseconds");
    const moment = new Date("2026-02-03T04:05:06.789Z");

    const { params } = stamps()
      .where(sql`${milliseconds} > ${milliseconds.value(moment)}`)
      .toSql();

    expect(params).toEqual([moment.getTime()]);
  });

  test("fragments with equal typed values have the same shape for or", async () => {
    const milliseconds = column("milliseconds");
    const nearest = (date: Date) =>
      stamps().reorder(sql`abs(${milliseconds} - ${milliseconds.value(date)})`);

    const both = nearest(day)
      .where({ name: "a" })
      .or(nearest(new Date(day)).where({ name: "c" }));

    // a and c are the same distance from the day, so their order isn't defined.
    expect((await names(both)).sort((x, y) => x.localeCompare(y))).toEqual(["a", "c"]);
  });

  test("fragments with different typed values don't have the same shape for or", () => {
    const milliseconds = column("milliseconds");
    const nearest = (date: Date) =>
      stamps().reorder(sql`abs(${milliseconds} - ${milliseconds.value(date)})`);

    expect(() =>
      nearest(day)
        .where({ name: "a" })
        .or(nearest(new Date("2026-01-03T00:00:00.000Z")).where({ name: "c" })),
    ).toThrow(IncompatibleRelation);
  });

  test("equal json typed values, as separate literals, have the same shape for or", () => {
    const settings = column("settings");
    const samples = () => shared.model(Sample);
    const ordered = (theme: string) =>
      samples().reorder(sql`${settings} = ${settings.value({ theme })}`);

    expect(() =>
      ordered("dark")
        .where({ label: "a" })
        .or(ordered("dark").where({ label: "b" })),
    ).not.toThrow();
  });
});
