import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import type { Adapter } from "../../src/adapter.ts";
import { d1Adapter } from "../../src/d1/adapter.ts";
import { D1Driver } from "../../src/d1/driver.ts";
import { AnyDatabase } from "../../src/database.ts";
import { DatabaseExecutor } from "../../src/executor.ts";
import { Model, NoDatabase, type TableAttributes, withDatabase } from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

const mark = "/* the other adapter */";

/** D1, as an adapter of another kind: its lists carry `mark`, which D1 reads as a comment. */
const otherAdapter: Adapter = {
  ...d1Adapter,
  dialect: {
    ...d1Adapter.dialect,
    inList(column, cells) {
      const list = d1Adapter.dialect.inList(column, cells);
      return { ...list, sql: `${list.sql} ${mark}` };
    },
  },
};

// Declared by hand: no schema names its binding or its adapter.
class Account extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
}) {
  static table = "users";
}

// A generated Model whose schema names the other adapter.
const members = { id: "integer", email: "string" } as const;
abstract class OtherRecord extends Model {
  static override schema = {
    adapter: { adapter: otherAdapter, binding: "DB" },
    tables: { users: { attributes: members, primaryKey: "id" } },
    models: { Member: "users" },
  } as const;
}
/* oxlint-disable typescript/no-unsafe-declaration-merging */
class Member extends OtherRecord {
  static override table = "users";
}
interface Member extends TableAttributes<typeof members> {}
/* oxlint-enable typescript/no-unsafe-declaration-merging */

describe("a statement's adapter", () => {
  let database: TestDatabase;
  let dispose: () => Promise<void>;
  let other: AnyDatabase;

  beforeAll(async () => {
    ({ db: database, dispose } = await createTestDatabase());
    other = new AnyDatabase(new DatabaseExecutor(otherAdapter, new D1Driver(database)));
  });

  afterAll(() => dispose());

  test("is its Database's", () => {
    expect(
      other
        .model(Account)
        .where({ id: [1, 2] })
        .toSql().sql,
    ).toContain(mark);
  });

  test("is the request's Database's, for a Model with no schema", async () => {
    const { sql } = await withDatabase(other, () => Account.where({ id: [1, 2] }).toSql());

    expect(sql).toContain(mark);
    expect(await withDatabase(other, () => Account.where({ id: [1, 2] }).toArray())).toEqual([]);
  });

  test("is the one its schema names, with no database", () => {
    expect(Member.where({ id: [1, 2] }).toSql().sql).toContain(mark);
  });

  test("is unknown with no database, for a Model with no schema, so it can't compile", () => {
    expect(() => Account.where({ id: [1, 2] }).toSql()).toThrow(NoDatabase);
  });
});
