import { describe, expect, expectTypeOf, test, vi } from "vite-plus/test";
import {
  Model,
  UnknownAttribute,
  NoDatabase,
  Relation,
} from "../../packages/active-record/src/index.ts";
import { connect } from "../../packages/active-record/src/adapters/d1/index.ts";

class User extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  age: "integer",
}) {
  static table = "users";
  static adults = this.scope((q) => q.where({ age: 18 }));
}

class Admin extends User {
  level = 1;
}

describe("Relation methods as a Model's statics", () => {
  test("they build Relations without a database, as Relations always do: nothing runs until awaited", () => {
    const relation = User.where({ email: "ada@example.com" }).order({ id: "desc" }).limit(2);

    expect(relation).toBeInstanceOf(Relation);
    expect(User.build({ email: "x@example.com" }).email).toBe("x@example.com");
  });

  test("each is typed for the class it's called on, overloads included", () => {
    // Type-checked, never run: these would query.
    const typed = () => {
      expectTypeOf(User.find(1)).toEqualTypeOf<Promise<User>>();
      expectTypeOf(User.find([1, 2])).toEqualTypeOf<Promise<User[]>>();
      expectTypeOf(User.find(1, 2)).toEqualTypeOf<Promise<User[]>>();
      expectTypeOf(User.pluck("email")).toEqualTypeOf<Promise<string[]>>();
      expectTypeOf(User.pluck("id", "age")).toEqualTypeOf<Promise<[number, number | null][]>>();
      expectTypeOf(User.first()).toEqualTypeOf<Promise<User | null>>();
      expectTypeOf(User.where({ age: 30 }).adults().toArray()).toEqualTypeOf<Promise<User[]>>();
      expectTypeOf(Admin.where({ age: 30 }).toArray()).toEqualTypeOf<Promise<Admin[]>>();
      expectTypeOf(Admin.adults().first()).toEqualTypeOf<Promise<Admin | null>>();
      expectTypeOf(Admin.create({ email: "a@example.com" })).toEqualTypeOf<Promise<Admin>>();
      // @ts-expect-error only User's attributes
      User.where({ nope: 1 });
      // @ts-expect-error find takes ids
      void User.find({ id: 1 });
    };
    void typed; // type-checked only
  });
});

describe("callback statics", () => {
  test("each is typed for the class it's declared on", () => {
    // Type-checked, never run: declaring callbacks on User would leak into other tests.
    const typed = () => {
      const isAdmin = (admin: Admin) => expectTypeOf(admin).toEqualTypeOf<Admin>();
      Admin.beforeValidation(isAdmin);
      Admin.afterValidation(isAdmin);
      Admin.beforeSave(isAdmin);
      Admin.beforeCreate(isAdmin);
      Admin.beforeUpdate(isAdmin);
      Admin.afterCreate(isAdmin);
      Admin.afterUpdate(isAdmin);
      Admin.afterSave(isAdmin);
      Admin.beforeDestroy(isAdmin);
      Admin.afterDestroy(isAdmin);
      // @ts-expect-error a User callback can't take only Admins
      User.beforeSave(isAdmin);
    };
    void typed; // type-checked only
  });
});

describe("none() with no database", () => {
  test("finders and counts answer, since it never reaches D1", async () => {
    const none = User.none();

    expect(await none.toArray()).toEqual([]);
    expect(await none.first()).toBeNull();
    expect(await none.last()).toBeNull();
    expect(await none.take()).toBeNull();
    expect(await none.findBy({ email: "ada@example.com" })).toBeNull();
    expect(await none.count()).toBe(0);
    expect(await none.exists()).toBe(false);
    await expect(none.find(1)).rejects.toThrow("User with id 1 not found");
  });

  test("arguments to counts, plucks and bulk writes are checked: an unknown attribute rejects", async () => {
    const none = User.none();

    await expect(none.count("nope" as never)).rejects.toThrow(UnknownAttribute);
    await expect(none.pluck("nope" as never)).rejects.toThrow(UnknownAttribute);
    await expect(none.updateAll({ nope: 1 } as never)).rejects.toThrow(UnknownAttribute);
  });

  test("other reads and bulk writes answer, wherever none() is in the chain", async () => {
    const none = User.where({ age: 30 }).none().order({ id: "desc" });

    expect(await none.pluck("email")).toEqual([]);
    expect(await none.exists({ email: "ada@example.com" })).toBe(false);
    expect([await none.size(), await none.isEmpty()]).toEqual([0, true]);
    await expect(none.find(1, 2)).rejects.toThrow("Couldn't find all User records");
    expect(await none.where({ email: "ada@example.com" }).findBy({ age: 30 })).toBeNull();
    expect([await none.updateAll({ age: 31 }), await none.deleteAll()]).toEqual([0, 0]);
  });
});

describe("withDatabase", () => {
  test("without Node.js compatibility, it says which Wrangler setting turns it on", async () => {
    vi.resetModules();
    const builtin = vi.spyOn(process, "getBuiltinModule").mockReturnValue(undefined as never);
    try {
      const { withDatabase } = await import("../../packages/active-record/src/index.ts");
      const { connect } = await import("../../packages/active-record/src/adapters/d1/index.ts");

      await expect(withDatabase(connect({} as never), () => 1)).rejects.toThrow(
        "withDatabase needs Node.js compatibility: a compatibility_date of 2026-08-04 or later, or the nodejs_compat flag, in your Wrangler config",
      );
    } finally {
      builtin.mockRestore();
    }
  });
});

describe("the statics' list", () => {
  test("every Relation method is a static of every Model, defined and typed", () => {
    const relationMethods = Object.getOwnPropertyNames(Relation.prototype).filter(
      (name) => name !== "constructor" && !name.startsWith("#"),
    );

    for (const name of relationMethods) {
      expect([name, typeof (User as unknown as Record<string, unknown>)[name]]).toEqual([
        name,
        "function",
      ]);
    }
    // Named as they're called, as class methods are, so stack traces and inspect say which.
    const callbackKinds = [
      "beforeValidation",
      "afterValidation",
      "beforeSave",
      "beforeCreate",
      "beforeUpdate",
      "afterCreate",
      "afterUpdate",
      "afterSave",
      "beforeDestroy",
      "afterDestroy",
    ];
    for (const name of [...relationMethods, ...callbackKinds]) {
      expect((User as unknown as Record<string, () => unknown>)[name]?.name).toBe(name);
    }
    // And in the types: no public Relation method is missing from a Model's statics.
    type Missing = Exclude<Extract<keyof Relation<User>, string>, keyof typeof User>;
    expectTypeOf<Missing>().toEqualTypeOf<never>();
  });
});

describe("a query at a module's top level", () => {
  test("Workers' refusal becomes a NoDatabase saying queries run during a request", async () => {
    // What workerd throws for a D1 call outside a request (checked in workerd itself).
    const refusal = new Error(
      "Disallowed operation called within global scope. Asynchronous I/O (ex: fetch() or connect()), setting a timeout, and generating random values are not allowed within global scope.",
    );
    const binding = {
      prepare: () => {
        throw refusal;
      },
    } as never;

    const error = await connect(binding)
      .model(User)
      .count()
      .catch((caught: unknown) => caught);

    expect(error).toEqual(
      new NoDatabase(
        "Queries run during a request: Workers don't allow D1 calls at a module's top level. Move the query into your fetch handler, or a function it calls",
      ),
    );
    expect((error as Error).cause).toBe(refusal);
  });
});
