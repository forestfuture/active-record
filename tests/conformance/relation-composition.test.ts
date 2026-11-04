import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import {
  IncompatibleRelation,
  Model,
  RecordNotFound,
  type Relation,
} from "../../packages/active-record/src/index.ts";
import { Post } from "../fixtures/models/post.ts";
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";

class User extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  role: "string",
  suspended: { type: "boolean", null: false },
}) {
  static table = "users";
}

const ids = async (relation: Relation<User>) => (await relation.toArray()).map((user) => user.id);

describe("relation composition", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await openHarness();
    await harness.exec(`INSERT INTO users (id, email, role, suspended) VALUES
           (1, 'a@example.com', 'admin',  0),
           (2, 'b@example.com', 'member', 1),
           (3, 'c@example.com', 'author', 0),
           (4, 'd@example.com', 'admin',  1)`);
  });
  afterAll(() => harness.dispose());

  test("or matches rows matching either relation's conditions, each side grouped", async () => {
    const users = harness.connect().model(User).order({ id: "asc" });

    const activeAdminsOrAuthors = users
      .where({ role: "admin", suspended: false })
      .or(users.where({ role: "author" }));

    expect(await ids(activeAdminsOrAuthors)).toEqual([1, 3]);
  });

  test("or rejects relations that differ in anything but their conditions", () => {
    const db = harness.connect();
    const users = db.model(User);

    expect(() => users.where({ role: "admin" }).or(users.limit(1))).toThrow(IncompatibleRelation);
    expect(() => users.or(users.order({ id: "desc" }))).toThrow(/order/);
    // @ts-expect-error a relation of another model
    expect(() => users.or(db.model(Post))).toThrow(IncompatibleRelation);
  });

  test("merge ANDs conditions, and the argument's explicit clauses replace the receiver's", async () => {
    const users = harness.connect().model(User);
    const base = users.where({ suspended: false }).order({ id: "desc" }).limit(10);

    const merged = base.merge(users.where({ role: "admin" }));
    const reordered = base.merge(users.order({ id: "asc" }).limit(1));

    expect(await ids(merged)).toEqual([1]);
    expect(await ids(reordered)).toEqual([1]);
    expect(await ids(base.merge(users))).toEqual([3, 1]);
  });

  test("merge rejects a relation of another Model", () => {
    const db = harness.connect();

    // @ts-expect-error a relation of another model
    expect(() => db.model(User).merge(db.model(Post))).toThrow(IncompatibleRelation);
  });

  test("none never touches the database, and every terminal operation returns an empty result", async () => {
    const queries: QueryEvent[] = [];
    const nothing = harness
      .connect({ onQuery: (event) => queries.push(event) })
      .model(User)
      .none()
      .where({ role: "admin" })
      .order({ id: "asc" });

    expect(await nothing.toArray()).toEqual([]);
    expect(await nothing.count()).toBe(0);
    expect(await nothing.exists()).toBe(false);
    expect(await nothing.first()).toBeNull();
    expect(await nothing.last()).toBeNull();
    expect(await nothing.take()).toBeNull();
    expect(await nothing.findBy({ id: 1 })).toBeNull();
    expect(await nothing.pluck("id")).toEqual([]);
    await expect(nothing.find(1)).rejects.toThrow(RecordNotFound);
    expect(queries).toHaveLength(0);
  });

  test("none drops out of or from either side, and merging with none gives none", async () => {
    const users = harness.connect().model(User).order({ id: "asc" });
    const admins = users.where({ role: "admin" });

    expect(await ids(users.none().or(admins))).toEqual([1, 4]);
    expect(await ids(admins.or(users.none()))).toEqual([1, 4]);
    expect(await ids(admins.merge(users.none()))).toEqual([]);
  });
});
