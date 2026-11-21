/* oxlint-disable typescript/no-unsafe-declaration-merging -- each interface stands in for the
   declarations active-record schema generates, which merge from another file: the accessors they
   type are defined when the Model's attributes resolve. */
// Attribute aliases (#509): another name for an attribute, which reads, writes and queries it.
import { inspect } from "node:util";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  test,
} from "vite-plus/test";
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
  suspended: { type: "boolean", null: false, default: () => false },
  createdAt: "datetime",
  updatedAt: "datetime",
} as const;

const schema = {
  adapter: d1({ binding: "DB" }),
  tables: { users: { attributes: users, primaryKey: "id" } },
  models: { User: "users", Member: "users", Guarded: "users", Normalized: "users" },
} as const;

abstract class ApplicationRecord extends Model {
  static override schema = schema;
}

class User extends ApplicationRecord {
  static override attributes = {
    login: { aliasOf: "email" },
    years: { aliasOf: "age" },
    paused: { aliasOf: "suspended" },
    joined: { aliasOf: "createdAt" },
  } as const;
  static override filterAttributes = ["email"];
}
interface User extends TableAttributes<typeof users, (typeof User)["attributes"]> {}

// Filtering its attribute's values by naming its alias.
class Guarded extends ApplicationRecord {
  static override table = "users";
  static override attributes = { login: { aliasOf: "email" } } as const;
  static override filterAttributes = ["login"];
}
interface Guarded extends TableAttributes<typeof users, (typeof Guarded)["attributes"]> {}

// Normalizing its attribute.
class Normalized extends ApplicationRecord {
  static override table = "users";
  static override attributes = { login: { aliasOf: "email" } } as const;
  static {
    this.normalizes("email", { with: (email) => email.trim().toLowerCase() });
  }
}
interface Normalized extends TableAttributes<typeof users, (typeof Normalized)["attributes"]> {}

// A subclass, sharing its parent's table and attributes.
class Admin extends User {}

// Validating through its aliases.
class Member extends ApplicationRecord {
  static override table = "users";
  static override attributes = { login: { aliasOf: "email" } } as const;
  static {
    this.humanAttributeNames({ login: "Sign-in" });
    this.validates("login", { format: /@/, uniqueness: true });
  }
}
interface Member extends TableAttributes<typeof users, (typeof Member)["attributes"]> {}

// Declaring its attributes, aliases among them, with define.
class Visitor extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  login: { aliasOf: "email" },
}) {
  static override table = "users";
}

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

      expect(await db().model(User).where({ login: "sam@example.com" }).pluck("id")).toEqual([2]);
    });

    test("matches its attribute in a negated condition", async () => {
      await seed();

      expect(await db().model(User).whereNot({ login: "sam@example.com" }).pluck("id")).toEqual([
        1,
      ]);
    });

    test("finds a record by its attribute", async () => {
      await seed();

      expect((await db().model(User).findBy({ login: "jane@example.com" }))?.id).toBe(1);
    });

    test("names its attribute's column in an sql fragment", async () => {
      await seed();

      const older = db()
        .model(User)
        .where(sql`${column("years")} > ${35}`);

      expect(await older.pluck("id")).toEqual([2]);
    });

    test("orders and plucks by its attribute", async () => {
      await seed();

      expect(await db().model(User).order({ login: "desc" }).pluck("login")).toEqual([
        "sam@example.com",
        "jane@example.com",
      ]);
    });

    test("selects its attribute, which the record holds under its own name", async () => {
      await seed();

      const [first] = await db().model(User).select("login").order({ id: "asc" }).toArray();

      expect(first!.attributes()).toEqual({ id: 1, email: "jane@example.com" });
    });

    test("groups by its attribute", async () => {
      await seed();

      expect(await db().model(User).group("years").count()).toEqual(
        new Map([
          [30, 1],
          [40, 1],
        ]),
      );
    });

    test("calculates over its attribute", async () => {
      await seed();

      expect(await db().model(User).sum("years")).toBe(70);
    });

    test("is replaced by rewhere on its attribute's condition", async () => {
      await seed();

      const replaced = db()
        .model(User)
        .where({ email: "jane@example.com" })
        .rewhere({ login: "sam@example.com" });

      expect(await replaced.pluck("id")).toEqual([2]);
    });

    test("is dropped by unscope naming its attribute", async () => {
      await seed();

      const dropped = db()
        .model(User)
        .where({ login: "sam@example.com" })
        .unscope({ where: "email" });

      expect(await dropped.order({ id: "asc" }).pluck("id")).toEqual([1, 2]);
    });
  });

  describe("in a write", () => {
    const emails = () => harness.exec("SELECT email FROM users ORDER BY id");

    test("builds a record from a form's permitted fields", () => {
      const form = User.permit({ login: "jane@example.com", role: "admin" }, "login");

      expect(db().model(User).build(form).email).toBe("jane@example.com");
    });

    test("creates a record", async () => {
      const created = await db().model(User).create({ login: "sam@example.com", years: 40 });

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

      expect(rows).toEqual([{ login: "sam@example.com" }]);
      expect(await harness.exec("SELECT email, age FROM users ORDER BY id")).toEqual([
        { email: "jane@example.com", age: 31 },
        { email: "sam@example.com", age: 40 },
      ]);
    });

    test("fills in what the row doesn't give under either name", async () => {
      const users = db().model(User);

      await users.insert({ login: "jane@example.com", paused: true, joined: new Date(0) });

      expect(await harness.exec("SELECT suspended, created_at FROM users")).toEqual([
        { suspended: 1, created_at: "1970-01-01T00:00:00.000Z" },
      ]);
    });

    test("binds its attribute's filtered value as filtered", async () => {
      await db()
        .model(User)
        .insertAll([{ login: "jane@example.com" }]);

      expect(JSON.stringify(events.map((event) => event.params))).not.toContain("jane@example.com");
    });

    test("refuses a row giving both it and its attribute", async () => {
      const users = db().model(User);
      const both = { email: "jane@example.com", login: "sam@example.com" };

      await expect(users.insert(both)).rejects.toThrow(
        new TypeError("User: login is an alias of email, so give one of them"),
      );
      await expect(users.updateAll(both)).rejects.toThrow(
        new TypeError("User: login is an alias of email, so give one of them"),
      );
    });

    test("updates every row", async () => {
      await db().model(User).create({ email: "jane@example.com" });

      await db().model(User).updateAll({ login: "sam@example.com" });

      expect(await emails()).toEqual([{ email: "sam@example.com" }]);
    });

    test("updates a record's columns", async () => {
      const user = await db().model(User).create({ email: "jane@example.com", age: 30 });

      await user.updateColumns({ years: 31 });
      await user.incrementColumn("years");

      expect(await harness.exec("SELECT age FROM users")).toEqual([{ age: 32 }]);
    });

    test("increments in memory", () => {
      const user = db().model(User).build({ email: "jane@example.com", age: 30 });

      user.increment("years");

      expect(user.age).toBe(31);
    });

    test("toggles in memory", () => {
      const user = db().model(User).build({ email: "jane@example.com" });

      user.toggle("paused");

      expect(user.suspended).toBe(true);
    });
  });

  describe("with its attribute normalized", () => {
    test("normalizes a value assigned through it", () => {
      const normalized = db().model(Normalized).build({ login: " Jane@Example.com " });

      expect(normalized.email).toBe("jane@example.com");
    });

    test("normalizes a value it's queried for", async () => {
      await harness.exec("INSERT INTO users (id, email) VALUES (1, 'jane@example.com')");

      expect(
        await db().model(Normalized).where({ login: " JANE@example.com" }).pluck("id"),
      ).toEqual([1]);
    });

    test("is a name normalizeValueFor takes", () => {
      expect(Normalized.normalizeValueFor("login", " Jane@Example.com")).toBe("jane@example.com");
    });

    test("is a name normalizeAttribute takes", async () => {
      await harness.exec("INSERT INTO users (id, email) VALUES (1, ' Jane@Example.com')");
      const normalized = await db().model(Normalized).find(1);

      normalized.normalizeAttribute("login");

      expect(normalized.email).toBe("jane@example.com");
    });

    test("normalizes a bulk write's value", async () => {
      await db().model(Normalized).insert({ login: " Jane@Example.com " });
      await db().model(Normalized).updateAll({ login: " Sam@Example.com " });

      expect(await harness.exec("SELECT email FROM users")).toEqual([{ email: "sam@example.com" }]);
    });
  });

  describe("in filterAttributes", () => {
    test("filters its attribute's bound values", async () => {
      await db().model(Guarded).create({ email: "jane@example.com" });
      await db().model(Guarded).where({ email: "jane@example.com" }).pluck("id");

      expect(JSON.stringify(events.map((event) => event.params))).not.toContain("jane@example.com");
    });

    test("filters its attribute when the record is shown", async () => {
      const guarded = db().model(Guarded).build({ email: "jane@example.com" });

      expect(inspect(guarded)).not.toContain("jane@example.com");
    });
  });

  describe("as a record's attributes", () => {
    test("is one the record has", async () => {
      const user = await db().model(User).create({ email: "jane@example.com" });

      expect(user.hasAttribute("login")).toBe(true);
    });

    test("is left out, since its attribute holds the value", async () => {
      const user = await db().model(User).create({ email: "jane@example.com" });

      expect(Object.keys(user.attributes())).not.toContain("login");
      expect(Object.keys(user.toJSON())).not.toContain("login");
      expect(inspect(user)).not.toContain("login");
    });
  });

  describe("validated", () => {
    test("reads its attribute, and its errors go under the alias, by the name given it", async () => {
      const member = db().model(Member).build({ email: "jane" });

      expect(await member.isValid()).toBe(false);
      expect(member.errors.fullMessages()).toEqual(["Sign-in is invalid"]);
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

  describe("on a Model declared with define", () => {
    test("is typed as its attribute, and writes it", async () => {
      const visitor = await db().model(Visitor).create({ login: "jane@example.com" });

      expectTypeOf(visitor.login).toEqualTypeOf<string>();
      expect(visitor.email).toBe("jane@example.com");
    });

    test("is queried as its attribute", async () => {
      await harness.exec("INSERT INTO users (id, email) VALUES (1, 'jane@example.com')");

      expect(await db().model(Visitor).where({ login: "jane@example.com" }).pluck("id")).toEqual([
        1,
      ]);
    });
  });

  describe("on a subclass", () => {
    test("is inherited with its parent's attributes", async () => {
      const admin = await db().model(Admin).create({ login: "jane@example.com" });

      expect(await db().model(Admin).where({ login: "jane@example.com" }).pluck("id")).toEqual([
        admin.id,
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
