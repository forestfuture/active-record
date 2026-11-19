import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { belongsTo, hasMany, hasOne, Model } from "../../packages/active-record/src/index.ts";
import { openHarness, type Harness } from "../support/harness.ts";

const log: string[] = [];
// What Person's afterFind and afterInitialize also do, set per test: a promise or an error.
const hooks: {
  afterFind?: () => unknown;
  afterInitialize?: () => unknown;
  bioAfterInitialize?: () => unknown;
} = {};

class Person extends Model.define({
  id: { type: "integer", null: false },
  email: "string",
}) {
  static table = "users";

  articles = hasMany(Article, { foreignKey: "userId" });
  bio = hasOne(Bio, { foreignKey: "userId" });

  static {
    this.afterInitialize((person) => {
      log.push(`afterInitialize ${person.email}`);
      return hooks.afterInitialize?.() as undefined;
    });
    this.afterFind((person) => {
      log.push(`afterFind ${person.email}`);
      return hooks.afterFind?.() as undefined;
    });
  }
}

class Article extends Model.define({
  id: { type: "integer", null: false },
  userId: "integer",
  title: "string",
}) {
  static table = "posts";

  author = belongsTo(Person, { foreignKey: "userId", optional: true });

  static {
    this.afterInitialize((article) => void log.push(`afterInitialize ${article.title}`));
    this.afterFind((article) => void log.push(`afterFind ${article.title}`));
  }
}

class Bio extends Model.define({
  id: { type: "integer", null: false },
  userId: "integer",
  bio: "string",
}) {
  static table = "profiles";

  static {
    this.afterInitialize((bio) => {
      log.push(`afterInitialize bio of ${bio.userId}`);
      return hooks.bioAfterInitialize?.() as undefined;
    });
  }
}

class Member extends Person {
  static {
    this.afterFind((member) => void log.push(`member afterFind ${member.email}`));
  }
}

class Contact extends Model.define({
  id: { type: "integer", null: false },
  email: "string",
}) {
  static table = "users";

  static {
    this.afterFind((contact) => {
      log.push(contact.hasAttribute("email") ? `email ${contact.email}` : "no email");
    });
  }
}

class Board extends Model.define({ id: { type: "integer", null: false } }) {
  static table = "boards";
  pins = hasMany(Pin);
  cards = hasMany(Card, { through: "pins" });
}

class Card extends Model.define({ id: { type: "integer", null: false } }) {
  static table = "cards";
}

class Pin extends Model.define({
  id: { type: "integer", null: false },
  boardId: "integer",
  cardId: "integer",
}) {
  static table = "pins";
  board = belongsTo(Board);
  card = belongsTo(Card);

  static {
    this.afterInitialize((pin) => void log.push(`afterInitialize pin of card ${pin.cardId}`));
  }
}

describe("afterFind and afterInitialize", () => {
  let harness: Harness;
  const people = () => harness.connect().model(Person);

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("pins", "cards", "boards", "posts", "profiles", "users");
    await harness.exec("INSERT INTO users (id, email) VALUES (1, 'a@example.com')");
    await harness.exec("INSERT INTO users (id, email) VALUES (2, 'b@example.com')");
    log.length = 0;
    delete hooks.afterFind;
    delete hooks.afterInitialize;
    delete hooks.bioAfterInitialize;
  });

  test("a query runs afterFind, then afterInitialize, for each record it loads", async () => {
    await people().order({ id: "asc" }).toArray();

    expect(log).toEqual([
      "afterFind a@example.com",
      "afterInitialize a@example.com",
      "afterFind b@example.com",
      "afterInitialize b@example.com",
    ]);
  });

  // Guards: every load makes its records the same way, so these pass with the first test.
  test("find, findBy and findEach run afterFind on each record", async () => {
    await people().find(1);
    await people().findBy({ email: "b@example.com" });
    for await (const person of people().findEach({ batchSize: 1 })) void person;

    expect(log.filter((line) => line.startsWith("afterFind"))).toEqual([
      "afterFind a@example.com",
      "afterFind b@example.com",
      "afterFind a@example.com",
      "afterFind b@example.com",
    ]);
  });

  test("association reads and preloads run them on the records they load", async () => {
    await harness.exec("INSERT INTO posts (id, user_id, title) VALUES (10, 1, 'First')");
    const article = await harness.connect().model(Article).find(10);
    const person = await people().find(1);
    log.length = 0;

    await article.author();
    await person.articles().toArray();
    await harness.connect().model(Article).includes("author").toArray();

    expect(log).toEqual([
      "afterFind a@example.com",
      "afterInitialize a@example.com",
      "afterFind First",
      "afterInitialize First",
      "afterFind First",
      "afterInitialize First",
      "afterFind a@example.com",
      "afterInitialize a@example.com",
    ]);
  });

  test("a subclass runs its parent's callbacks, then its own", async () => {
    await harness.connect().model(Member).find(1);

    expect(log).toEqual([
      "afterFind a@example.com",
      "member afterFind a@example.com",
      "afterInitialize a@example.com",
    ]);
  });

  test("reload runs afterFind, then afterInitialize, on the record itself", async () => {
    const person = await people().find(1);
    await harness.exec("UPDATE users SET email = 'new@example.com' WHERE id = 1");
    log.length = 0;

    await person.reload();

    expect(log).toEqual(["afterFind new@example.com", "afterInitialize new@example.com"]);
  });

  test("a partial record from select runs them, and hasAttribute says what it loaded", async () => {
    const contacts = harness.connect().model(Contact);
    await contacts.select("id").order({ id: "asc" }).toArray();
    await contacts.find(1);

    expect(log).toEqual(["no email", "no email", "email a@example.com"]);
  });

  // A guard: hasAttribute looks names up in the Model's own attributes.
  test("hasAttribute is true for a built record's attributes, and false for other names", () => {
    const contact = harness.connect().model(Contact).build({ email: "c@example.com" });

    expect(contact.hasAttribute("id")).toBe(true);
    expect(contact.hasAttribute("email")).toBe(true);
    expect(contact.hasAttribute("nickname")).toBe(false);
    expect(contact.hasAttribute("constructor")).toBe(false);
  });

  test("build runs afterInitialize after its init", () => {
    const person = people().build({ email: "c@example.com" }, (built) => {
      log.push(`init ${built.email}`);
    });

    expect(person.email).toBe("c@example.com");
    expect(log).toEqual(["init c@example.com", "afterInitialize c@example.com"]);
  });

  test("create runs afterInitialize after its init, before saving", async () => {
    await harness
      .connect({ onQuery: (event) => log.push(event.sql.split(" ")[0] ?? "") })
      .model(Person)
      .create({ id: 3, email: "c@example.com" }, (built) => void log.push(`init ${built.email}`));

    expect(log).toEqual(["init c@example.com", "afterInitialize c@example.com", "INSERT"]);
  });

  test("findOrInitializeBy runs afterInitialize on the record it builds, after its init", async () => {
    await people().findOrInitializeBy({ email: "c@example.com" }, (built) => {
      log.push(`init ${built.email}`);
    });

    expect(log).toEqual(["init c@example.com", "afterInitialize c@example.com"]);
  });

  test("an association's build and create run afterInitialize", async () => {
    const person = await people().find(1);
    log.length = 0;

    const built = person.articles().build({ title: "Built" });
    await person.articles().create({ id: 10, title: "Created" });
    built.author.build({ email: "c@example.com" });

    expect(log).toEqual([
      "afterInitialize Built",
      "afterInitialize Created",
      "afterInitialize c@example.com",
    ]);
  });

  test("a record built through an association already points at its owner", async () => {
    const person = await people().find(1);
    log.length = 0;

    person.bio.build({ bio: "Hi" });

    expect(log).toEqual(["afterInitialize bio of 1"]);
  });

  // Guards: the callbacks have refused a promise and let errors through since they were added.
  test("a load callback that returns a promise throws TypeError, as nothing awaits it", async () => {
    hooks.afterFind = () => Promise.reject(new Error("never seen"));
    await expect(people().find(1)).rejects.toThrow(
      new TypeError(
        "Person.afterFind: a callback returned a promise, which nothing awaits; afterFind runs synchronously",
      ),
    );

    hooks.afterInitialize = async () => {};
    expect(() => people().build({ email: "c@example.com" })).toThrow(TypeError);
  });

  test("an error in a load callback reaches the caller, with no records", async () => {
    const error = new Error("unreadable");
    hooks.afterInitialize = () => {
      throw error;
    };

    await expect(people().toArray()).rejects.toBe(error);
    expect(() => people().build({ email: "c@example.com" })).toThrow(error);
  });

  test("a hasOne build whose afterInitialize throws leaves its owner's record in place", async () => {
    await harness.exec("INSERT INTO profiles (id, user_id, bio) VALUES (5, 1, 'Old')");
    const person = await people().includes("bio").find(1);
    const error = new Error("unbuildable");
    hooks.bioAfterInitialize = () => {
      throw error;
    };

    expect(() => person.bio.build({ bio: "New" })).toThrow(error);
    await person.saveOrThrow();

    expect(person.loaded("bio")?.id).toBe(5);
    expect(await harness.connect().model(Bio).pluck("id")).toEqual([5]);
  });

  test("a join record built through a through hasMany already points at its record", async () => {
    await harness.exec("INSERT INTO boards (id) VALUES (1)");
    const board = await harness.connect().model(Board).find(1);

    board.cards().build({ id: 7 });

    expect(log).toEqual(["afterInitialize pin of card 7"]);
  });
});
