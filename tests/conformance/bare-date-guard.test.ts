import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { column, Model, sql } from "../../src/index.ts";
import { openHarness, type Harness } from "../support/harness.ts";
import { fragment } from "../support/fragments.ts";

// An integer-stored attribute, one mapped to another column, and an ISO one (#149).
class Stamp extends Model.define({
  id: { type: "integer", null: false },
  seconds: { type: "datetime", storage: "unixSeconds" },
  milliseconds: { type: "datetime", storage: "unixMilliseconds" },
  mapped: { type: "datetime", storage: "unixSeconds", column: "mapped_at" },
  iso: "datetime",
}) {
  static table = "guarded_stamps";
}

describe("a bare date beside an integer-stored column in a fragment (#149)", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await openHarness();
    await harness.exec(
      "CREATE TABLE guarded_stamps (id INTEGER PRIMARY KEY, seconds INTEGER, milliseconds INTEGER, mapped_at INTEGER, iso TEXT)",
    );
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.exec("DELETE FROM guarded_stamps");
  });

  const stamps = () => harness.connect().model(Stamp);
  const seconds = column("seconds");
  const milliseconds = column("milliseconds");
  const mapped = column("mapped");
  const iso = column("iso");
  const day = new Date("2026-01-02T00:00:00.000Z");
  const refusal = (attribute: string, storage: string, what = "Date") =>
    new TypeError(
      `Stamp: a ${what} beside "${attribute}", which is stored as ${storage}, is bound as ISO text. Use column("${attribute}").value(…) for it.`,
    );

  describe("is refused", () => {
    test("a bare Date after the column throws TypeError when the fragment is used", () => {
      expect(() => stamps().where(sql`${seconds} > ${day}`)).toThrow(
        refusal("seconds", "unixSeconds"),
      );
    });

    test.each(["=", "==", "<>", "!=", "<", "<=", ">", ">="])("the comparison %s", (operator) => {
      expect(() => stamps().where(fragment(["", ` ${operator} `, ""], seconds, day))).toThrow(
        refusal("seconds", "unixSeconds"),
      );
    });

    test("a bare Date before the column", () => {
      expect(() => stamps().where(sql`${day} < ${milliseconds}`)).toThrow(
        refusal("milliseconds", "unixMilliseconds"),
      );
    });

    test("a bare Date as BETWEEN's lower bound", () => {
      expect(() => stamps().where(sql`${seconds} BETWEEN ${day} AND ${5}`)).toThrow(
        refusal("seconds", "unixSeconds"),
      );
    });

    test("a bare Date as NOT BETWEEN's upper bound", () => {
      expect(() => stamps().where(sql`${seconds} NOT BETWEEN ${5} AND ${day}`)).toThrow(
        refusal("seconds", "unixSeconds"),
      );
    });

    test("a bare Date as the value BETWEEN tests, with the column as a bound", () => {
      expect(() => stamps().where(sql`${day} BETWEEN ${seconds} AND ${6}`)).toThrow(
        refusal("seconds", "unixSeconds"),
      );
      expect(() => stamps().where(sql`${day} NOT BETWEEN ${5} AND ${seconds}`)).toThrow(
        refusal("seconds", "unixSeconds"),
      );
    });

    test("an ISO datetime string, as a Date is", () => {
      expect(() => stamps().where(sql`${seconds} > ${"2026-01-02T00:00:00Z"}`)).toThrow(
        refusal("seconds", "unixSeconds", "string"),
      );
    });

    test("SQLite's own date text, which has no zone", () => {
      expect(() => stamps().where(sql`${seconds} > ${"2026-01-02 03:04:05"}`)).toThrow(
        refusal("seconds", "unixSeconds", "string"),
      );
    });

    test("a column mapped to another name, by its attribute", () => {
      expect(() => stamps().where(sql`${mapped} > ${day}`)).toThrow(
        refusal("mapped", "unixSeconds"),
      );
    });

    test("whereNot", () => {
      expect(() => stamps().whereNot(sql`${seconds} > ${day}`)).toThrow(TypeError);
    });

    test("order", () => {
      expect(() => stamps().order(sql`${seconds} = ${day}`)).toThrow(TypeError);
    });

    test("reorder", () => {
      expect(() => stamps().reorder(sql`${seconds} = ${day}`)).toThrow(TypeError);
    });

    test("findBy, before it queries", async () => {
      await expect(stamps().findBy(sql`${seconds} > ${day}`)).rejects.toThrow(TypeError);
    });

    test("exists, before it queries", async () => {
      await expect(stamps().exists(sql`${seconds} > ${day}`)).rejects.toThrow(TypeError);
    });

    test("updateAll, before it writes", async () => {
      await expect(stamps().updateAll(sql`${seconds} = ${day}`)).rejects.toThrow(
        refusal("seconds", "unixSeconds"),
      );
    });
  });

  describe("is not refused", () => {
    test("the typed value beside the column", async () => {
      await harness.exec("INSERT INTO guarded_stamps VALUES (1, 1767312000, NULL, NULL, NULL)");

      const count = await stamps()
        .where(sql`${seconds} >= ${seconds.value(day)}`)
        .count();

      expect(count).toBe(1);
    });

    test("a bare number beside the column", () => {
      expect(() => stamps().where(sql`${seconds} > ${1767225600}`)).not.toThrow();
    });

    test("a string that isn't a date beside the column", () => {
      expect(() => stamps().where(sql`${seconds} = ${"abc"}`)).not.toThrow();
    });

    test("a bare Date beside an ISO datetime attribute's column", () => {
      expect(() => stamps().where(sql`${iso} > ${day}`)).not.toThrow();
    });

    test("an expression between the column and the value", () => {
      expect(() => stamps().where(sql`abs(${seconds} - ${day}) < ${5}`)).not.toThrow();
    });

    test("two columns compared", () => {
      expect(() => stamps().where(sql`${seconds} = ${milliseconds}`)).not.toThrow();
    });

    test("an IN list, which isn't read", () => {
      expect(() => stamps().where(sql`${seconds} IN (${day}, ${day})`)).not.toThrow();
    });

    test("IS, which isn't read", () => {
      expect(() => stamps().where(sql`${seconds} IS ${day}`)).not.toThrow();
    });
  });
});
