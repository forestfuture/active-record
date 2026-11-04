import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import {
  IncompatibleRelation,
  InvalidModel,
  Model,
  type Relation,
  type ScopeStatic,
} from "../../packages/active-record/src/index.ts";
import { connect } from "../../packages/d1-record/src/index.ts";

class User extends Model.define({
  id: { type: "integer", null: false },
  role: "string",
  isActive: "boolean",
}) {
  static table = "users";

  static active = this.scope((q) => q.where({ isActive: true }));
  static admins = this.scope((q) => q.where({ role: "admin" }));
  static withRole = this.scope((q, role: string) => q.where({ role }));
}

// No D1 needed: calling scopes only builds Relations.
const db = connect({} as never);

describe("scopes as statics", () => {
  test("a scope is a static of its Model and a method of its Relations, typed with its arguments", () => {
    // Type-checked, never run: these would query.
    const typed = () => {
      expectTypeOf(User.active().admins().toArray()).toEqualTypeOf<Promise<User[]>>();
      expectTypeOf(db.model(User).where({ role: "x" }).withRole("a").toArray()).toEqualTypeOf<
        Promise<User[]>
      >();
    };
    void typed; // type-checked only
    expect(typeof User.active().withRole("editor").admins).toBe("function");
    // @ts-expect-error a scope's arguments are typed
    User.withRole(1);
  });

  test("a subclass inherits its parent's scopes, typed as the subclass, and can add or replace one", () => {
    class Staff extends User {
      static override admins = this.scope((q) => q.where({ role: "staff-admin" }));
      static inactive = this.scope((q) => q.where({ isActive: false }));
    }

    const typed = () => expectTypeOf(Staff.active().first()).toEqualTypeOf<Promise<Staff | null>>();
    void typed; // type-checked only
    expect(typeof Staff.active().admins().inactive).toBe("function");
    expect("inactive" in db.model(User)).toBe(false);
    expect(Staff.admins).not.toBe(User.admins);
    // @ts-expect-error the parent never gains a subclass's scope
    void User.inactive;
  });
});

describe("scope rules", () => {
  test("a scope named like a Relation method, a Model static, or then, is rejected on first use", () => {
    class Clash extends Model.define({ id: "integer" }) {
      static table = "users";
      // A compile error too (count is a static); reached through a cast to test the runtime check.
      static override count = this.scope((q) => q.limit(1)) as never;
    }
    class Static extends Model.define({ id: "integer" }) {
      static table = "users";
      static override validates = this.scope((q) => q) as never;
    }
    class Thenable extends Model.define({ id: "integer" }) {
      static table = "users";
      // oxlint-disable-next-line unicorn/no-thenable -- the point of the test: a "then" scope is rejected
      static then = this.scope((q) => q);
    }

    expect(() => db.model(Clash)).toThrow(InvalidModel);
    expect(() => db.model(Clash)).toThrow(/Clash.*"count"/);
    expect(() => db.model(Static)).toThrow(/Static.*"validates"/);
    expect(() => db.model(Thenable)).toThrow(/"then"/);
  });

  test("a scope must return a Relation of its own Model", () => {
    class Sloppy extends Model.define({ id: "integer", role: "string" }) {
      static table = "users";
      // @ts-expect-error forgot to return the Relation
      static forgetful = this.scope((q) => {
        q.where({ role: "admin" });
      });
    }

    // The broken scope fails its type check, so reach it through a cast.
    const sloppy = db.model(Sloppy) as unknown as { forgetful: () => unknown };
    expect(() => sloppy.forgetful()).toThrow(TypeError);
    expect(() => sloppy.forgetful()).toThrow(/Sloppy.*"forgetful".*Relation/);
  });
});

describe("relations stay on their Database", () => {
  // Checked when the query runs (#93): a scope may return a Relation on the current database.
  test("a scope that returns a Relation on another Database is rejected when it runs", async () => {
    const otherDb = connect({} as never);
    class Wanderer extends Model.define({ id: "integer" }) {
      static table = "users";
      // Naming its own class, the scope needs its type written out, as any self-reference does.
      static elsewhere: ScopeStatic<[]> = this.scope(
        () => otherDb.model(Wanderer) as unknown as Relation<Wanderer>,
      );
    }

    const elsewhere = db.model(Wanderer).elsewhere() as unknown as Relation<Wanderer>;
    await expect(elsewhere.toArray()).rejects.toThrow(IncompatibleRelation);
    await expect(elsewhere.toArray()).rejects.toThrow(
      /Wanderer scope "elsewhere" needs its relations on one database/,
    );
  });

  test("or() and merge() reject a Relation from another Database when they run", async () => {
    const here = db.model(User);
    const there = connect({} as never).model(User);

    await expect(here.or(there).toArray()).rejects.toThrow(IncompatibleRelation);
    await expect(here.merge(there).toArray()).rejects.toThrow(
      /merge\(\) needs its relations on one database/,
    );
  });
});

describe("scope timing", () => {
  test("replacing a scope after the Model's first use throws, rather than being ignored", () => {
    class Late extends Model.define({ id: "integer", role: "string" }) {
      static table = "users";
      static admins = this.scope((q) => q.where({ role: "admin" }));
    }
    db.model(Late);

    Late.admins = Late.scope((q) => q.where({ role: "owner" }));

    expect(() => db.model(Late)).toThrow(InvalidModel);
    expect(() => db.model(Late)).toThrow(/Late.*scopes.*static/);
  });
});
