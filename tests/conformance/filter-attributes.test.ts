import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { type FilterAttribute, gte, Model, RecordNotFound, sql } from "../../src/index.ts";
import type { QueryEvent } from "../../src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";

class User extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false }, // filtered by default: "email"
  role: "string",
}) {
  static table = "users";
}

// A secret as the primary key: sessions or API keys looked up by their token.
class Session extends Model.define({
  token: { type: "string", null: false, column: "id" },
  label: { type: "string", null: false },
}) {
  static table = "api_keys";
  static primaryKey = "token";
}

// What onQuery listeners see of a filtered attribute's values: "[FILTERED]", as in Rails' logs.
// The database still gets the real values (#83).
describe("filterAttributes", () => {
  let harness: Harness;
  let events: QueryEvent[];
  const db = () => harness.connect({ onQuery: (event) => events.push(event) });
  const params = () => events.map((event) => event.params);

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("users", "api_keys");
    events = [];
  });

  test("an insert's and an update's values for a filtered attribute are hidden from listeners", async () => {
    const user = await db().model(User).create({ id: 1, email: "ada@example.com", role: "admin" });
    await user.update({ email: "ada@lovelace.dev", role: "owner" });

    expect(params()).toEqual([
      [1, "[FILTERED]", "admin"],
      ["[FILTERED]", "owner", 1],
    ]);
    expect(await harness.exec("SELECT email FROM users")).toEqual([{ email: "ada@lovelace.dev" }]);
  });

  test("a multi-row insert hides a filtered attribute's values in its JSON", async () => {
    await db()
      .model(User)
      .insertAll([
        { id: 1, email: "ada@example.com", role: "admin" },
        { id: 2, email: "grace@example.com", role: null },
      ]);

    expect(params()).toEqual([
      [
        JSON.stringify([
          [1, "[FILTERED]", "admin"],
          [2, "[FILTERED]", null],
        ]),
      ],
    ]);
    expect(await db().model(User).pluck("email")).toEqual(["ada@example.com", "grace@example.com"]);
  });

  test("updateAll hides a filtered attribute's new value", async () => {
    await db().model(User).insert({ id: 1, email: "ada@example.com" });
    events = [];

    await db().model(User).updateAll({ email: "x@example.com", role: "admin" });

    expect(params()).toEqual([["[FILTERED]", "admin"]]);
  });

  test("conditions, lists and comparisons on a filtered attribute are hidden too", async () => {
    const users = db().model(User);

    await users.findBy({ email: "ada@example.com", role: "admin" });
    await users.where({ email: ["a@example.com", "b@example.com"] }).toArray();
    await users.where({ email: gte("m") }).count();

    // findBy's LIMIT 1 is the last value.
    expect(params()).toEqual([["[FILTERED]", "admin", 1], ["[FILTERED]"], ["[FILTERED]"]]);
  });

  test("a value in an sql fragment has no attribute, so it's shown as given", async () => {
    await db()
      .model(User)
      .where(sql`email = ${"ada@example.com"}`)
      .toArray();

    expect(params()).toEqual([["ada@example.com"]]);
  });

  test("a filtered primary key is hidden when a record is updated or destroyed", async () => {
    const session = await db().model(Session).create({ token: "s3cr3t", label: "a" });
    await session.update({ label: "b" });
    await session.destroy();

    expect(params()).toEqual([["[FILTERED]", "a"], ["b", "[FILTERED]"], ["[FILTERED]"]]);
  });

  test("RecordNotFound shows a filtered primary key as [FILTERED]", async () => {
    const sessions = db().model(Session);
    const session = await sessions.create({ token: "s3cr3t", label: "a" });
    await harness.exec("DELETE FROM api_keys");

    await expect(sessions.find("guess")).rejects.toThrow(
      new RecordNotFound("Session with token [FILTERED] not found"),
    );
    await expect(sessions.find(["guess", "other"])).rejects.toThrow(
      new RecordNotFound(
        "Couldn't find all Session records with 'token': ([FILTERED], [FILTERED]) " +
          "(found 0 results, but was looking for 2)",
      ),
    );
    await expect(session.reload()).rejects.toThrow(
      new RecordNotFound("Session with token [FILTERED] not found"),
    );
  });

  test("upsert and a limited updateAll are hidden too", async () => {
    await db().model(User).upsert({ id: 1, email: "ada@example.com" }, { uniqueBy: "id" });
    await db()
      .model(User)
      .where({ email: "ada@example.com" })
      .limit(1)
      .updateAll({ email: "x@example.com" });

    // upsert binds its rows as one JSON value, as insertAll does.
    expect(params()).toEqual([
      [JSON.stringify([[1, "[FILTERED]"]])],
      ["[FILTERED]", "[FILTERED]", 1],
    ]);
  });

  test("a cast error from a bulk write hides a filtered value too", () => {
    const error = new TypeError('User: [FILTERED] isn\'t a string for "email"');

    expect(() =>
      db()
        .model(User)
        .toInsert({ id: 1, email: 42 as never }),
    ).toThrow(error);
    expect(() =>
      db()
        .model(User)
        .toUpdateAll({ email: 42 as never }),
    ).toThrow(error);
  });

  test("a cast error shows a filtered attribute's value as [FILTERED]", () => {
    expect(() =>
      db()
        .model(User)
        .build({ email: 42 as never }),
    ).toThrow(new TypeError('User: [FILTERED] isn\'t a string for "email"'));
    expect(() =>
      db()
        .model(User)
        .build({ role: 42 as never }),
    ).toThrow(new TypeError('User: 42 isn\'t a string for "role"'));
  });

  describe("which attributes are filtered", () => {
    const named = (filterAttributes: readonly FilterAttribute[]) =>
      class extends Model.define({
        id: { type: "integer", null: false },
        passwordDigest: "string",
        apiKey: "string",
        nickname: "string",
      }) {
        static override table = "accounts";
        static override filterAttributes = filterAttributes;
      };

    test("Rails' defaults match a camelCase attribute's snake_case name, in any case", async () => {
      expect(await hiddenNames(named(Model.filterAttributes))).toEqual([
        "passwordDigest", // passw
        "apiKey", // _key, as api_key
      ]);
    });

    test("a RegExp matches the attribute or its snake_case name", async () => {
      expect(await hiddenNames(named([/^nick/]))).toEqual(["nickname"]);
      expect(await hiddenNames(named([/_digest$/]))).toEqual(["passwordDigest"]);
    });

    test("a list replaces the defaults, so [] filters nothing", async () => {
      expect(await hiddenNames(named(["NICK"]))).toEqual(["nickname"]);
      expect(await hiddenNames(named([]))).toEqual([]);
    });

    test("set on an app's base class, every Model built on it inherits it", async () => {
      abstract class Base extends Model {
        static override filterAttributes = [...Model.filterAttributes, "nickname"];
      }
      class Account extends Base.define({
        id: "integer",
        passwordDigest: "string",
        apiKey: "string",
        nickname: "string",
      }) {}

      expect(await hiddenNames(Account)).toEqual(["passwordDigest", "apiKey", "nickname"]);
    });

    /** The attributes whose value in a condition a listener sees as "[FILTERED]". */
    async function hiddenNames(model: object) {
      const hidden: string[] = [];
      for (const name of ["passwordDigest", "apiKey", "nickname"]) {
        const seen: QueryEvent[] = [];
        await harness
          .connect({ onQuery: (event) => seen.push(event) })
          .model(model as ReturnType<typeof named>) // any Model with these attributes
          .where({ [name]: "x" } as never)
          .toArray();
        if (seen[0]?.params[0] === "[FILTERED]") hidden.push(name);
      }
      return hidden;
    }
  });
});
