/* oxlint-disable typescript/no-unsafe-declaration-merging -- each interface stands in for the
   declarations active-record schema generates, which merge from another file: the accessors they
   type are defined when the Model's attributes resolve. */
// Attribute aliases (#509): another name for an attribute, which reads, writes and queries it.
import { inspect } from "node:util";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  Model,
  column,
  sql,
  type TableAttributes,
} from "../../packages/active-record/src/index.ts";
import { d1 } from "../../packages/active-record/src/adapters/d1/index.ts";
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";

// A generated schema, as `active-record schema` writes it, for Models built on it.
const users = {
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  role: "string",
  age: "integer",
  createdAt: "datetime",
  updatedAt: "datetime",
} as const;

const schema = {
  adapter: d1({ binding: "DB" }),
  tables: { users: { attributes: users, primaryKey: "id" } },
  models: { User: "users", Member: "users" },
} as const;

abstract class ApplicationRecord extends Model {
  static override schema = schema;
}

class User extends ApplicationRecord {
  static override attributes = {
    login: { aliasOf: "email" },
    years: { aliasOf: "age" },
  } as const;
}
interface User extends TableAttributes<typeof users, (typeof User)["attributes"]> {}

// Validating through its aliases.
class Member extends ApplicationRecord {
  static override table = "users";
  static override attributes = { login: { aliasOf: "email" } } as const;
  static {
    this.validates("login", { format: /@/, uniqueness: true });
  }
}
interface Member extends TableAttributes<typeof users, (typeof Member)["attributes"]> {}

describe("an attribute alias", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());

  const events: QueryEvent[] = [];
  const db = () => harness.connect({ onQuery: (event) => events.push(event) });
  beforeEach(async () => {
    await harness.reset("posts", "users");
    events.length = 0;
  });

  describe("on a record", () => {
    test("reads its attribute's value", async () => {
      await harness.exec("INSERT INTO users (id, email) VALUES (1, 'jane@example.com')");

      const user = await db().model(User).find(1);

      expect(user.login).toBe("jane@example.com");
    });

    test("writes its attribute, which a save stores", async () => {
      const user = db().model(User).build({ email: "jane@example.com" });

      user.login = "sam@example.com";
      await user.save();

      expect(user.email).toBe("sam@example.com");
      expect(await harness.exec("SELECT email FROM users")).toEqual([{ email: "sam@example.com" }]);
    });
  });

  describe("in a query", () => {
    const seed = () =>
      harness.exec(
        "INSERT INTO users (id, email, age) VALUES (1, 'jane@example.com', 30), (2, 'sam@example.com', 40)",
      );

    test("matches its attribute in a condition", async () => {
      await seed();
      const users = db().model(User);

      expect((await users.where({ login: "sam@example.com" }).toArray()).map((u) => u.id)).toEqual([
        2,
      ]);
      expect(
        (await users.whereNot({ login: "sam@example.com" }).toArray()).map((u) => u.id),
      ).toEqual([1]);
      expect((await users.findBy({ login: "jane@example.com" }))?.id).toBe(1);
      expect(await users.where(sql`${column("years")} > ${35}`).pluck("id")).toEqual([2]);
    });

    test("orders, plucks, selects and groups by its attribute", async () => {
      await seed();
      const users = db().model(User);

      expect(await users.order({ login: "desc" }).pluck("login")).toEqual([
        "sam@example.com",
        "jane@example.com",
      ]);
      const [first] = await users.select("login").order({ id: "asc" }).toArray();
      expect(first!.email).toBe("jane@example.com");
      expect(await users.group("years").count()).toEqual(
        new Map([
          [30, 1],
          [40, 1],
        ]),
      );
    });

    test("calculates over its attribute", async () => {
      await seed();
      const users = db().model(User);

      expect(await users.sum("years")).toBe(70);
      expect(await users.maximum("years")).toBe(40);
    });

    test("is the same condition as its attribute's, so rewhere and unscope replace either", async () => {
      await seed();
      const users = db().model(User);

      const replaced = users
        .where({ email: "jane@example.com" })
        .rewhere({ login: "sam@example.com" });
      const dropped = users.where({ login: "sam@example.com" }).unscope({ where: "email" });

      expect(await replaced.pluck("id")).toEqual([2]);
      expect((await dropped.pluck("id")).sort()).toEqual([1, 2]);
    });
  });

  describe("in a write", () => {
    const emails = () => harness.exec("SELECT email FROM users ORDER BY id");

    test("builds and creates a record", async () => {
      const users = db().model(User);
      const form = User.permit({ login: "jane@example.com", role: "admin" }, "login");

      const built = users.build(form);
      const created = await users.create({ login: "sam@example.com", years: 40 });

      expect(built.email).toBe("jane@example.com");
      expect([created.email, created.age]).toEqual(["sam@example.com", 40]);
    });

    test("creates through a Relation's conditions and createWith", async () => {
      const users = db().model(User);

      const found = await users.findOrCreateBy({ login: "jane@example.com" });
      const made = await users
        .createWith({ years: 30 })
        .findOrCreateBy({ login: "sam@example.com" });

      expect(found.email).toBe("jane@example.com");
      expect([made.email, made.age]).toEqual(["sam@example.com", 30]);
    });

    test("inserts and upserts rows", async () => {
      const users = db().model(User);

      await users.insert({ login: "jane@example.com" });
      const { rows } = await users.insertAll([{ login: "sam@example.com", years: 40 }], {
        returning: ["login"],
      });
      await users.upsert({ login: "jane@example.com", years: 31 }, { uniqueBy: ["login"] });

      expect(rows).toEqual([{ email: "sam@example.com" }]); // keyed as select loads it
      expect(await harness.exec("SELECT email, age FROM users ORDER BY id")).toEqual([
        { email: "jane@example.com", age: 31 },
        { email: "sam@example.com", age: 40 },
      ]);
    });

    test("updates rows and columns", async () => {
      const user = await db().model(User).create({ email: "jane@example.com", age: 30 });

      await db().model(User).updateAll({ login: "sam@example.com" });
      await user.updateColumns({ years: 31 });
      await user.incrementColumn("years");
      user.increment("years");

      expect(await emails()).toEqual([{ email: "sam@example.com" }]);
      expect(user.age).toBe(33);
    });
  });

  describe("as a record's attributes", () => {
    test("is left out, since its attribute holds the value", async () => {
      const user = await db().model(User).create({ email: "jane@example.com" });

      expect(Object.keys(user.attributes())).not.toContain("login");
      expect(Object.keys(user.toJSON())).not.toContain("login");
      expect(inspect(user)).not.toContain("login");
    });
  });

  describe("validated", () => {
    test("reads its attribute, and its errors go under the alias", async () => {
      const member = db().model(Member).build({ email: "jane" });

      expect(await member.isValid()).toBe(false);
      expect(member.errors.fullMessages()).toEqual(["Login is invalid"]);
    });

    test("for uniqueness, queries its attribute", async () => {
      await harness.exec("INSERT INTO users (id, email) VALUES (1, 'jane@example.com')");
      const member = db().model(Member).build({ login: "jane@example.com" });

      expect(await member.isValid()).toBe(false);
      expect(member.errors.toArray().map(({ attribute, type }) => `${attribute} ${type}`)).toEqual([
        "login taken",
      ]);
    });
  });

  describe("its changes", () => {
    test("are listed under the attribute it names", async () => {
      const user = await db().model(User).create({ email: "jane@example.com" });

      user.login = "sam@example.com";

      expect(user.changes()).toEqual({ email: ["jane@example.com", "sam@example.com"] });
    });

    test("are read through the alias by the methods that take a name", async () => {
      const user = await db().model(User).create({ email: "jane@example.com" });
      user.login = "sam@example.com";

      expect(user.attributeWas("login")).toBe("jane@example.com");
      expect(user.isAttributeChanged("login", { to: "sam@example.com" })).toBe(true);
      expect(user.willSaveChangeTo("login")).toBe(true);
      expect(user.hasAttribute("login")).toBe(true);
    });

    test("are read through the alias once saved", async () => {
      const user = await db().model(User).create({ email: "jane@example.com" });

      await user.update({ email: "sam@example.com" });

      expect(user.savedChangeTo("login")).toEqual(["jane@example.com", "sam@example.com"]);
      expect(user.hasSavedChangeTo("login")).toBe(true);
      expect(user.attributeBeforeLastSave("login")).toBe("jane@example.com");
    });

    test("are undone through the alias", async () => {
      const user = await db().model(User).create({ email: "jane@example.com" });
      user.login = "sam@example.com";

      user.restoreAttributes(["login"]);

      expect(user.email).toBe("jane@example.com");
    });
  });
});
