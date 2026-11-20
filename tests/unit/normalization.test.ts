// Normalizations (#354): `this.normalizes(name, { with })`, applied to a value as it's assigned.
// These tests need no database.
import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import { InvalidModel, Model, UnknownAttribute } from "../../packages/active-record/src/index.ts";
import { connect, d1 } from "../../packages/active-record/src/adapters/d1/index.ts";

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

  test("refuses a function of another type", () => {
    class Visit extends Model.define({
      id: { type: "integer", null: false },
      path: "string",
    }) {
      static table = "visits";

      static {
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

describe("several normalizations", () => {
  test("run in the order they're declared", () => {
    class Slug extends Model.define({
      id: { type: "integer", null: false },
      text: "string",
    }) {
      static table = "slugs";

      static {
        this.normalizes("text", { with: (text) => `${text}-first` });
        this.normalizes("text", { with: (text) => `${text}-second` });
      }
    }

    expect(db.model(Slug).build({ text: "a" }).text).toBe("a-first-second");
  });

  test("run a parent class's first, and leave the parent's own records alone", () => {
    class Handle extends Model.define({
      id: { type: "integer", null: false },
      name: "string",
    }) {
      static table = "handles";

      static {
        this.normalizes("name", { with: (name) => name.trim() });
      }
    }
    class LoudHandle extends Handle {
      static {
        this.normalizes("name", { with: (name) => `${name}!` });
      }
    }

    expect(db.model(LoudHandle).build({ name: " sam " }).name).toBe("sam!");
    expect(db.model(Handle).build({ name: " sam " }).name).toBe("sam");
  });
});

describe("a normalization's attribute", () => {
  test("must be one of the Model's attributes", () => {
    const defining = () =>
      class Visit extends Model.define({
        id: { type: "integer", null: false },
        path: "string",
      }) {
        static table = "visits";

        static {
          // @ts-expect-error -- not an attribute
          this.normalizes("pathname", { with: (path: string) => path });
        }
      };

    expect(defining).toThrow(
      new InvalidModel('Visit normalizes "pathname", which isn\'t one of its attributes'),
    );
  });

  test("may be virtual", () => {
    class Signup extends Model.define({
      id: { type: "integer", null: false },
      nickname: { type: "string", virtual: true },
    }) {
      static table = "signups";

      static {
        this.normalizes("nickname", { with: (nickname) => nickname.trim() });
      }
    }

    expect(db.model(Signup).build({ nickname: " sam " }).nickname).toBe("sam");
  });

  test("is declared before the Model is used", () => {
    class Note extends Model.define({
      id: { type: "integer", null: false },
      body: "string",
    }) {
      static table = "notes";
    }
    db.model(Note).build();

    expect(() => Note.normalizes("body", { with: (body) => body.trim() })).toThrow(InvalidModel);
  });
});

describe("a generated Model's normalization", () => {
  const people = {
    id: { type: "integer", null: false },
    email: { type: "string", null: false },
    legacyNotes: "string",
  } as const;

  abstract class AppRecord extends Model {
    static override schema = {
      adapter: d1({ binding: "DB" }),
      tables: { people: { attributes: people, primaryKey: "id" } },
      models: { Person: "people" },
    } as const;
  }

  test("of an ignored column is refused when the Model is first used", () => {
    class Person extends AppRecord {
      static override attributes = { legacyNotes: false } as const;

      static {
        this.normalizes("legacyNotes" as never, {
          with: ((notes: string) => notes.trim()) as never,
        });
      }
    }

    expect(() => db.model(Person).build()).toThrow(
      new InvalidModel('Person normalizes "legacyNotes", which isn\'t one of its attributes'),
    );
  });
});

describe("normalizeValueFor", () => {
  test("casts a value, then normalizes it", () => {
    const email = Account.normalizeValueFor("email", "  Jane@Example.COM ");
    expectTypeOf(email).toEqualTypeOf<string | null>();
    expect(email).toBe("jane@example.com");
  });

  test("leaves null alone", () => {
    expect(Account.normalizeValueFor("email", null)).toBeNull();
  });

  test("casts an attribute with no normalization", () => {
    expect(Account.normalizeValueFor("id", "7")).toBe(7);
  });

  test("throws UnknownAttribute for a name that isn't an attribute", () => {
    // @ts-expect-error -- not an attribute
    expect(() => Account.normalizeValueFor("mail", "x")).toThrow(
      new UnknownAttribute('Account has no attribute "mail"'),
    );
  });
});

describe("typeForAttribute", () => {
  test("casts and serializes a value normalized", () => {
    const { cast, serialize, deserialize } = Account.typeForAttribute("email");
    expect(cast(" Jane@Example.com")).toBe("jane@example.com");
    expect(serialize(" Jane@Example.com")).toBe("jane@example.com");
    expect(deserialize(" Jane@Example.com")).toBe(" Jane@Example.com");
  });
});

describe("normalizeAttribute", () => {
  test("leaves null alone", () => {
    const account = accounts.build();
    account.normalizeAttribute("email");
    expect(account.email).toBeNull();
  });

  test("takes only an attribute's name", () => {
    const account = accounts.build();
    // @ts-expect-error -- not an attribute
    expect(() => account.normalizeAttribute("mail")).toThrow(UnknownAttribute);
  });
});

describe("a condition on a normalized attribute", () => {
  // Plain JavaScript, past the types: a rank over 100 normalizes to nothing.
  class Rank extends Model.define({
    id: { type: "integer", null: false },
    level: "integer",
  }) {
    static table = "ranks";

    static {
      this.normalizes("id", { with: ((id: number) => (id > 100 ? undefined : id)) as never });
      this.normalizes("level", { with: (level) => Math.abs(level) });
    }
  }
  const ranks = db.model(Rank);

  test("that can't be cast names its value when a record is built from it", () => {
    expect(() => ranks.where({ level: "high" as never }).build()).toThrow(
      new TypeError('Rank: "high" isn\'t an integer for "level"'),
    );
  });

  test("throws when its normalization returns what the attribute can't hold", () => {
    expect(() => ranks.whereNot({ id: 200 })).toThrow(
      new TypeError('Rank: got undefined for "id"; use null to store NULL'),
    );
  });

  test("throws for find's keys when their normalization returns what the key can't hold", async () => {
    await expect(ranks.find([1, 200])).rejects.toThrow(
      new TypeError('Rank: got undefined for "id"; use null to store NULL'),
    );
  });
});

describe("a record built from a Relation", () => {
  class Label extends Model.define({
    id: { type: "integer", null: false },
    text: "string",
  }) {
    static table = "labels";

    static {
      this.normalizes("text", { with: (text) => `${text}!` });
    }
  }
  const labels = db.model(Label);

  test("takes a condition's value as the query normalized it, once", () => {
    expect(labels.where({ text: "a" }).build().text).toBe("a!");
  });

  test("normalizes a createWith value once", () => {
    expect(labels.createWith({ text: "a" }).build().text).toBe("a!");
  });

  test("normalizes a given value once, over a condition's", () => {
    expect(labels.where({ text: "a" }).build({ text: "b" }).text).toBe("b!");
  });
});
