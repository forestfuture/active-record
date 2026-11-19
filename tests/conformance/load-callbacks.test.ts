import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { belongsTo, hasMany, hasOne, Model } from "../../packages/active-record/src/index.ts";
import { openHarness, type Harness } from "../support/harness.ts";

const log: string[] = [];

class Person extends Model.define({
  id: { type: "integer", null: false },
  email: "string",
}) {
  static table = "users";

  articles = hasMany(Article, { foreignKey: "userId" });
  bio = hasOne(Bio, { foreignKey: "userId" });

  static {
    this.afterInitialize((person) => void log.push(`afterInitialize ${person.email}`));
    this.afterFind((person) => void log.push(`afterFind ${person.email}`));
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
    this.afterInitialize((bio) => void log.push(`afterInitialize bio of ${bio.userId}`));
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

describe("afterFind and afterInitialize", () => {
  let harness: Harness;
  const people = () => harness.connect().model(Person);

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("posts", "profiles", "users");
    await harness.exec("INSERT INTO users (id, email) VALUES (1, 'a@example.com')");
    await harness.exec("INSERT INTO users (id, email) VALUES (2, 'b@example.com')");
    log.length = 0;
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
});
