import { describe, expect, test } from "vite-plus/test";
import {
  hasMany,
  InvalidModel,
  Model,
  type ErrorMessages,
} from "../../packages/active-record/src/index.ts";
import { connect } from "../../packages/active-record/src/adapters/d1/index.ts";

// No D1 needed: none of these validations asks it anything.
const db = connect({} as never);

const tables = {
  accounts: {
    attributes: { id: "integer", email: "string", handle: "string", createdAt: "datetime" },
    primaryKey: "id",
  },
  posts: { attributes: { id: "integer", title: "string" }, primaryKey: "id" },
} as const;

class Base extends Model {
  static {
    this.humanAttributeNames({ createdAt: "Signed up", email: "Email" });
    this.errorMessages({
      blank: "is required",
      tooShort: { one: "needs at least 1 character", other: "needs at least %{count} characters" },
    });
  }
}
/** The accounts and posts tables' attributes, on the app's base class. */
const AccountRecord = Base.define(tables.accounts.attributes);
const PostRecord = Base.define(tables.posts.attributes);

class Account extends AccountRecord {
  static {
    this.validates("email", { presence: true });
    this.validates("handle", { length: { minimum: 3 } });
  }
}

class Post extends PostRecord {
  static {
    this.validates("title", { presence: true, length: { minimum: 1 } });
  }
}

class Member extends AccountRecord {
  static {
    this.errorMessages({
      blank: "must be filled in",
      attributes: { email: { blank: "is needed to sign in" } },
    });
    this.validates("email", { presence: true });
    this.validates("handle", { presence: true, length: { minimum: 3 } });
  }
}

class Admin extends Member {
  static {
    this.errorMessages({ attributes: { handle: { tooShort: "is too short for an admin" } } });
  }
}

class Guest extends Member {}

/** The full messages of a record of `model` built from `attributes`, once validated. */
async function messagesOf(model: typeof Account | typeof Post | typeof Member, attributes: object) {
  const record = db.model(model as typeof Account).build(attributes as never);
  await record.isValid();
  return record.errors.fullMessages();
}

// Changing the copy of error messages (#88).
describe("error messages", () => {
  test("the app's base class replaces a built-in message for every Model", async () => {
    expect(await messagesOf(Account, { email: "", handle: "ab" })).toEqual([
      "Email is required",
      "Handle needs at least 3 characters",
    ]);
  });

  test("a base class's plural message has a form for a count of one", async () => {
    expect(await messagesOf(Post, { title: "" })).toEqual([
      "Title is required",
      "Title needs at least 1 character",
    ]);
  });

  test("a Model's message for an attribute wins over its message for the type", async () => {
    expect(await messagesOf(Member, { email: "", handle: "ab" })).toEqual([
      "Email is needed to sign in",
      "Handle needs at least 3 characters",
    ]);
  });

  test("a Model's message for a type wins over the base class's", async () => {
    expect(await messagesOf(Member, { email: "a@example.com", handle: "" })).toEqual([
      "Handle must be filled in",
      "Handle needs at least 3 characters",
    ]);
  });

  test("a subclass's own messages win over its parent Model's", async () => {
    expect(await messagesOf(Admin, { email: "a@example.com", handle: "" })).toEqual([
      "Handle must be filled in",
      "Handle is too short for an admin",
    ]);
  });

  test("a subclass without messages of its own has its parent Model's", async () => {
    expect(await messagesOf(Guest, { email: "", handle: "abc" })).toEqual([
      "Email is needed to sign in",
    ]);
  });

  test("a class's own type wins over an attribute's message from a class it extends", async () => {
    class Strict extends Base {
      static {
        this.errorMessages({ attributes: { title: { blank: "x" } } });
      }
    }
    class Note extends Strict.define(tables.posts.attributes) {
      static {
        this.errorMessages({ blank: "is empty" });
        this.validates("title", { presence: true });
      }
    }

    expect(await messagesOf(Note as never, { title: "" })).toEqual(["Title is empty"]);
  });

  test("a message is worked out when it's read, so %{value} is the value then", async () => {
    class Handle extends AccountRecord {
      static {
        this.errorMessages({ invalid: "%{value} isn't a handle" });
        this.validates("handle", { format: /^[a-z]+$/ });
      }
    }
    const account = db.model(Handle).build({ handle: "Ada!" });
    await account.isValid();

    account.handle = "Ada?";

    expect(account.errors.get("handle")).toEqual(["Ada? isn't a handle"]);
  });

  test("full messages and %{attribute} use the names from humanAttributeNames", async () => {
    class Signup extends AccountRecord {
      static {
        this.humanAttributeNames({ email: "Email address" });
        this.errorMessages({
          attributes: { createdAt: { blank: "is missing: %{attribute} is set on save" } },
        });
        this.validates("email", { presence: true });
        this.validates("createdAt", { presence: true });
      }
    }

    expect(await messagesOf(Signup as never, { email: "" })).toEqual([
      "Email address is required",
      "Signed up is missing: Signed up is set on save",
    ]);
  });

  test("humanAttributeName() gives a Model's name for an attribute, its base class's, or one in words", () => {
    class Signup extends AccountRecord {
      static {
        this.humanAttributeNames({ email: "Email address" });
      }
    }

    expect(["email", "createdAt", "handle"].map((name) => Signup.humanAttributeName(name))).toEqual(
      ["Email address", "Signed up", "Handle"],
    );
  });

  test("humanAttributeName() before a Model's first use sees names declared after it", () => {
    class Early extends AccountRecord {}

    const before = Early.humanAttributeName("handle");
    Early.humanAttributeNames({ handle: "Username" });

    expect([before, Early.humanAttributeName("handle")]).toEqual(["Handle", "Username"]);
  });

  test("a parent's names declared after its subclass's still reach the subclass, as its messages do", () => {
    class Parent extends AccountRecord {}
    class Child extends Parent {
      static {
        this.humanAttributeNames({ email: "Email address" });
      }
    }

    Parent.humanAttributeNames({ handle: "Username" });

    expect(Child.humanAttributeName("handle")).toBe("Username");
  });

  test("errors.add with a type alone looks its message up", () => {
    class Booking extends PostRecord {
      static {
        this.errorMessages({ afterStart: "must be after the start" });
      }
    }
    const booking = db.model(Booking).build();

    booking.errors.add("title", { type: "afterStart" });

    expect(booking.errors.fullMessages()).toEqual(["Title must be after the start"]);
  });

  test("errors.add fills a message's placeholders from the values given", () => {
    const member = db.model(Member).build({ handle: "ab" });

    member.errors.add("handle", { type: "tooShort", count: 5 });

    expect(member.errors.fullMessages()).toEqual(["Handle needs at least 5 characters"]);
  });

  test("errors.add with a message uses it as it is", () => {
    const member = db.model(Member).build();

    member.errors.add("base", "Account is locked");

    expect(member.errors.fullMessages()).toEqual(["Account is locked"]);
  });

  test("a type with no message anywhere is refused when it's added", () => {
    const member = db.model(Member).build();

    expect(() => member.errors.add("handle", { type: "afterStart" })).toThrow(
      /No message for the error "afterStart" on "handle": add one to Member's errorMessages/,
    );
    expect(member.errors.size).toBe(0);
  });

  test("errors.add's options are typed", () => {
    const member = db.model(Member).build();

    // @ts-expect-error a type is required when there's no message
    expect(() => member.errors.add("handle", { count: 3 })).toThrow();
    // @ts-expect-error a value is text or a number
    expect(() => member.errors.add("handle", { type: "blank", at: new Date() })).not.toThrow();
  });

  test("toArray() gives an error's values, when it has some, but never the attribute's value", async () => {
    const account = db.model(Account).build({ email: "", handle: "ab" });
    await account.isValid();
    account.errors.add("base", { type: "blank", reason: "locked" });

    expect(account.errors.toArray()).toStrictEqual([
      { attribute: "email", type: "blank", message: "is required" },
      {
        attribute: "handle",
        type: "tooShort",
        message: "needs at least 3 characters",
        values: { count: 3 },
      },
      { attribute: "base", type: "blank", message: "is required", values: { reason: "locked" } },
    ]);
  });

  test("messages for an attribute a Model doesn't have are refused at first use", () => {
    class Typo extends AccountRecord {
      static {
        // @ts-expect-error a Model's messages name its attributes, associations or base
        this.errorMessages({ attributes: { emial: { blank: "x" } } });
      }
    }

    expect(() => db.model(Typo)).toThrow(
      new InvalidModel(
        "Typo's errorMessages has messages for \"emial\", which isn't one of its attributes or associations; name them exactly",
      ),
    );
  });

  test("a name for an attribute a Model doesn't have is refused at first use", () => {
    class Renamed extends AccountRecord {
      static {
        // @ts-expect-error the same for its attribute names
        this.humanAttributeNames({ emial: "Email address" });
      }
    }

    expect(() => db.model(Renamed)).toThrow(/Renamed's humanAttributeNames names "emial"/);
  });

  test("a Model's messages and names can be for its associations and base", () => {
    class Owner extends AccountRecord {
      posts = hasMany(Post, { foreignKey: "id" });
      static {
        this.errorMessages({
          attributes: { base: { blank: "x" }, posts: { invalid: "have a problem" } },
        });
        this.humanAttributeNames({ posts: "Articles" });
      }
    }

    expect(() => db.model(Owner)).not.toThrow();
  });

  test("the base class's names apply where a Model has the attribute, and are ignored elsewhere", () => {
    // The app's base class names createdAt and email, which Post doesn't have.
    expect(() => db.model(Post)).not.toThrow();
  });

  test("%{value} is the attribute's value, and %{model} the Model in words", async () => {
    class BlogAccount extends AccountRecord {
      static {
        this.errorMessages({ invalid: "%{value} isn't allowed for a %{model}" });
        this.validates("handle", { format: /^[a-z]+$/ });
      }
    }

    expect(await messagesOf(BlogAccount as never, { handle: "Ada!" })).toEqual([
      "Handle Ada! isn't allowed for a Blog account",
    ]);
  });

  test("%{model} is the Model's modelName in words, when it sets one", async () => {
    // As a bundler that renames classes leaves it: named e, but still the BlogAccount Model.
    const e = class extends AccountRecord {
      static override modelName = "BlogAccount";
      static {
        this.errorMessages({ invalid: "isn't allowed for a %{model}" });
        this.validates("handle", { format: /^[a-z]+$/ });
      }
    };

    expect(await messagesOf(e as never, { handle: "Ada!" })).toEqual([
      "Handle isn't allowed for a Blog account",
    ]);
  });

  test("%{value} of a filtered attribute is [FILTERED]", async () => {
    class Contact extends AccountRecord {
      static {
        this.errorMessages({ invalid: "%{value} isn't an email" });
        this.validates("email", { format: /@/ });
      }
    }

    expect(await messagesOf(Contact as never, { email: "ada" })).toEqual([
      "Email [FILTERED] isn't an email",
    ]);
  });

  test("a class's calls add up, and a later one's message wins", async () => {
    const shared: ErrorMessages = { blank: "is required here" };
    class Twice extends PostRecord {
      static {
        this.errorMessages(shared);
        this.errorMessages({ tooShort: "is too short" });
        this.errorMessages({ blank: "is required, twice" });
        this.validates("title", { presence: true, length: { minimum: 1 } });
      }
    }

    expect(await messagesOf(Twice as never, { title: "" })).toEqual([
      "Title is required, twice",
      "Title is too short",
    ]);
  });

  test("a class's calls add up for an attribute, type by type", async () => {
    class Twice extends PostRecord {
      static {
        this.errorMessages({ attributes: { title: { blank: "first", tooShort: "short" } } });
        this.errorMessages({ attributes: { title: { blank: "second" } } });
        this.validates("title", { presence: true, length: { minimum: 1 } });
      }
    }

    expect(await messagesOf(Twice as never, { title: "" })).toEqual([
      "Title second",
      "Title short",
    ]);
  });

  test("messages can't be declared once a Model is used", () => {
    class Late extends PostRecord {}
    db.model(Late);

    expect(() => Late.errorMessages({ blank: "later" })).toThrow(InvalidModel);
  });
});
