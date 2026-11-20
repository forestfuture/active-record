// Normalizations (#354): `this.normalizes(name, { with })`, applied to a value as it's assigned.
// These tests need no database.
import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import { Model } from "../../packages/active-record/src/index.ts";
import { connect } from "../../packages/active-record/src/adapters/d1/index.ts";

const db = connect({} as never);

class Account extends Model.define({
  id: { type: "integer", null: false },
  email: "string",
}) {
  static table = "accounts";

  static {
    this.normalizes("email", { with: (email) => email.trim().toLowerCase() });
  }
}

const accounts = db.model(Account);

describe("normalizes", () => {
  test("normalizes a value assigned through the setter", () => {
    const account = accounts.build();
    account.email = "  Jane@Example.COM ";
    expect(account.email).toBe("jane@example.com");
  });

  test("normalizes the values build is given", () => {
    const account = accounts.build({ email: " Sam@Example.com" });
    expect(account.email).toBe("sam@example.com");
  });

  test("normalizes the values assign is given", () => {
    const account = accounts.build().assign({ email: "Sam@Example.com " });
    expect(account.email).toBe("sam@example.com");
  });

  test("normalizes an attribute's default", () => {
    class Invite extends Model.define({
      id: { type: "integer", null: false },
      code: { type: "string", default: () => " ab12 " },
    }) {
      static table = "invites";

      static {
        this.normalizes("code", { with: (code) => code.trim().toUpperCase() });
      }
    }

    expect(db.model(Invite).build().code).toBe("AB12");
  });

  test("hands with the attribute's type, without null", () => {
    class Visit extends Model.define({
      id: { type: "integer", null: false },
      path: "string",
      count: { type: "integer", null: false },
    }) {
      static table = "visits";

      static {
        this.normalizes("path", {
          with: (path) => {
            expectTypeOf(path).toEqualTypeOf<string>();
            return path;
          },
        });
        this.normalizes("count", {
          with: (count) => {
            expectTypeOf(count).toEqualTypeOf<number>();
            return count;
          },
        });
      }
    }

    expect(db.model(Visit).build({ path: "/", count: 1 }).count).toBe(1);
  });

  test("refuses a name that isn't an attribute, and a function of another type", () => {
    class Visit extends Model.define({
      id: { type: "integer", null: false },
      path: "string",
    }) {
      static table = "visits";

      static {
        // @ts-expect-error -- not an attribute
        this.normalizes("pathname", { with: (path: string) => path });
        // @ts-expect-error -- a string attribute's normalizer returns a string
        this.normalizes("path", { with: (path) => path.length });
      }
    }
    expect(Visit.table).toBe("visits");
  });
});

describe("normalizes and null", () => {
  test("leaves null alone", () => {
    const account = accounts.build({ email: "jane@example.com" });
    account.email = null;
    expect(account.email).toBeNull();
  });

  test("hands null to with when it applies to null", () => {
    class Profile extends Model.define({
      id: { type: "integer", null: false },
      bio: "string",
    }) {
      static table = "profiles";

      static {
        this.normalizes("bio", {
          with: (bio) => {
            expectTypeOf(bio).toEqualTypeOf<string | null>();
            return bio?.trim() ?? "";
          },
          applyToNull: true,
        });
      }
    }

    expect(db.model(Profile).build({ bio: null }).bio).toBe("");
  });
});

describe("what with returns", () => {
  class Tag extends Model.define({
    id: { type: "integer", null: false },
    name: "string",
    weight: "integer",
  }) {
    static table = "tags";

    static {
      // Plain JavaScript, past the types: a list for a string, a promise, and a throw.
      this.normalizes("name", {
        with: ((name: string) => (name === "list" ? [name] : name)) as never,
      });
      this.normalizes("weight", { with: (async (weight: number) => weight) as never });
      this.normalizes("name", {
        with: (name) => {
          if (name === "bad") throw new RangeError("no bad names");
          return name;
        },
      });
    }
  }
  const tags = db.model(Tag);

  test("is cast again, refused when the attribute's type can't hold it", () => {
    expect(() => tags.build({ name: "list" })).toThrow(
      new TypeError('Tag: ["list"] isn\'t a string for "name"'),
    );
  });

  test("is refused when it's a promise", () => {
    expect(() => tags.build({ weight: 2 })).toThrow(
      new TypeError(
        'Tag normalizes "weight" with a function that returned a promise; a normalization runs synchronously',
      ),
    );
  });

  test("throws what with throws", () => {
    expect(() => tags.build({ name: "bad" })).toThrow(new RangeError("no bad names"));
  });
});
