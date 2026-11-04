import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { Model, UnknownAttribute } from "../../src/index.ts";
import type { QueryEvent } from "../../src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";

let counter = 0;

class ApiKey extends Model.define({
  id: { type: "string", null: false, default: () => `key-${++counter}` },
  label: { type: "string", null: false },
  scopes: "json",
  createdAt: "datetime",
}) {
  static table = "api_keys";
}

class Comment extends Model.define({
  id: { type: "integer", null: false },
  postId: "integer",
  body: "string",
}) {
  static table = "comments";
}

/** Rows in a stable order: neither D1 nor Postgres promises the order of `RETURNING`. */
const byId = <T extends { id?: unknown }>(rows: readonly T[]) =>
  rows.toSorted((a, b) => String(a.id).localeCompare(String(b.id)));

describe("what a bulk write resolves to", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("comments", "api_keys");
  });

  test("insert resolves to the rows it wrote and each one's primary key, generated in code", async () => {
    const keys = harness.connect().model(ApiKey);

    const result = await keys.insert({ label: "deploy" });

    const [stored] = await keys.pluck("id");
    expect(result).toEqual({ rowsAffected: 1, rows: [{ id: stored }] });
  });

  test("a key the database generates comes back too", async () => {
    const comments = harness.connect().model(Comment);

    const { rows } = await comments.insert({ body: "First" });

    expect(rows).toEqual([{ id: (await comments.pluck("id"))[0] }]);
  });

  test("insertAll returns every row's key, in one statement", async () => {
    const events: QueryEvent[] = [];
    const keys = harness.connect({ onQuery: (event) => events.push(event) }).model(ApiKey);

    const result = await keys.insertAll([{ label: "deploy" }, { label: "release" }]);

    expect(events).toHaveLength(1);
    expect(result.rowsAffected).toBe(2);
    expect(byId(result.rows)).toEqual(byId((await keys.pluck("id")).map((id) => ({ id }))));
  });

  test("returning names the attributes to return, each read as its type", async () => {
    const keys = harness.connect().model(ApiKey);
    const createdAt = new Date(Date.UTC(2020, 0, 1));

    const { rows } = await keys.insert(
      { id: "a", label: "deploy", scopes: ["read"], createdAt },
      { returning: ["label", "scopes", "createdAt"] },
    );

    expect(rows).toEqual([{ label: "deploy", scopes: ["read"], createdAt }]);
  });

  test("returning: false sends no RETURNING and resolves to no rows", async () => {
    const events: QueryEvent[] = [];
    const keys = harness.connect({ onQuery: (event) => events.push(event) }).model(ApiKey);

    const result = await keys.insertAll([{ label: "deploy" }], { returning: false });

    expect(result).toEqual({ rowsAffected: 1, rows: [] });
    expect(events[0]?.sql).not.toContain("RETURNING");
    expect(keys.toInsert({ label: "x" }, { returning: false }).toSql().sql).not.toContain(
      "RETURNING",
    );
  });

  test("returning: [] returns no rows too, and a returning that isn't a list throws", async () => {
    const keys = harness.connect().model(ApiKey);

    expect(await keys.insert({ label: "deploy" }, { returning: [] })).toEqual({
      rowsAffected: 1,
      rows: [],
    });
    expect(() => keys.toInsert({ label: "x" }, { returning: "id" as never })).toThrow(TypeError);
    expect(() => keys.toInsert({ label: "x" }, { returning: true as never })).toThrow(TypeError);
  });

  test("a row skipped as a duplicate isn't returned", async () => {
    const keys = harness.connect().model(ApiKey);
    await keys.insert({ id: "a", label: "deploy" });

    const result = await keys.insertAll(
      [
        { id: "a", label: "again" },
        { id: "b", label: "release" },
      ],
      { onDuplicate: "skip" },
    );

    expect(result).toEqual({ rowsAffected: 1, rows: [{ id: "b" }] });
  });

  test("upsert returns the rows it inserted and the ones it updated", async () => {
    const keys = harness.connect().model(ApiKey);
    await keys.insert({ id: "a", label: "deploy" });

    const result = await keys.upsertAll(
      [
        { id: "a", label: "deploy 2" },
        { id: "b", label: "release" },
      ],
      { returning: ["id", "label"] },
    );

    expect(result.rowsAffected).toBe(2);
    expect(byId(result.rows)).toEqual([
      { id: "a", label: "deploy 2" },
      { id: "b", label: "release" },
    ]);
  });

  test("insert({}), with every value a default, returns what it was asked for", async () => {
    const comments = harness.connect().model(Comment);

    const { rows } = await comments.insert({}, { returning: ["id", "body"] });

    expect(rows).toEqual([{ id: (await comments.pluck("id"))[0], body: null }]);
    expect((await comments.insert({}, { returning: false })).rows).toEqual([]);
  });

  test("an attribute returning names that the Model doesn't have throws when the write is built", () => {
    const keys = harness.connect().model(ApiKey);

    expect(() => keys.toInsert({ label: "x" }, { returning: ["nope" as never] })).toThrow(
      UnknownAttribute,
    );
  });
});
