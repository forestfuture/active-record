import { readdirSync, readFileSync } from "node:fs";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, expectTypeOf, test, vi } from "vite-plus/test";
import { runSchema } from "../../../packages/active-record/cli/schema/command.ts";
import { connect, type QueryEvent } from "../../../packages/active-record/src/adapters/d1/index.ts";
import { Listing } from "../../fixtures/schema-project/src/models/listing.ts";
import { Product } from "../../fixtures/schema-project/src/models/product.ts";
import { Task } from "../../fixtures/schema-project/src/models/task.ts";
import { User } from "../../fixtures/schema-project/src/models/user.ts";
import { Visit } from "../../fixtures/schema-project/src/models/visit.ts";
import { statementKinds } from "../../support/statement-kinds.ts";

const projectDir = new URL("../../fixtures/schema-project/", import.meta.url).pathname;

describe("a schema generated from migrations", () => {
  let mf: Miniflare;
  let binding: Awaited<ReturnType<Miniflare["getD1Database"]>>;

  beforeAll(async () => {
    mf = new Miniflare({ modules: true, script: "export default {}", d1Databases: ["DB"] });
    binding = await mf.getD1Database("DB");
    for (const file of readdirSync(`${projectDir}migrations`).sort()) {
      await binding.exec(
        readFileSync(`${projectDir}migrations/${file}`, "utf8").replaceAll("\n", " "),
      );
    }
    await binding.exec("CREATE TABLE visits (id INTEGER PRIMARY KEY, path TEXT NOT NULL)");
  });
  afterAll(() => mf.dispose());

  test("is current: the committed schema.ts is what its migrations and Models generate", async () => {
    const output: string[] = [];

    expect(
      await runSchema({ cwd: projectDir, out: "schema.ts", check: true }, (line) =>
        output.push(line),
      ),
    ).toBe(0);
  });

  test("a CHECK's names are a generated enum, whose methods enum: true turns on (#64)", async () => {
    expectTypeOf<Task["state"]>().toEqualTypeOf<"open" | "done">();
    expectTypeOf(Task.done).toBeFunction();
    const db = connect(binding);
    const task = await db.model(Task).createOrThrow({ title: "Write the guide" });

    expect(task.isOpen()).toBe(true);
    await task.saveAsDoneOrThrow();
    expect(await db.model(Task).done().pluck("title")).toEqual(["Write the guide"]);
    expect(() => db.model(Task).build({ state: "lost" as never })).toThrow(TypeError);
  });

  test("an override's enum scopes are listed in the schema and typed as statics (#340)", async () => {
    expectTypeOf(User.editor).toBeFunction();
    expectTypeOf<User["role"]>().toEqualTypeOf<"member" | "editor">();
    expect(readFileSync(`${projectDir}schema.ts`, "utf8")).toContain(
      'User: ["member", "notMember", "editor", "notEditor"]',
    );

    const db = connect(binding);
    await db.model(User).createOrThrow({ email: "root@example.com", role: "editor" });

    expect(await db.model(User).editor().pluck("email")).toEqual(["root@example.com"]);
  });

  test("types each attribute from its column", () => {
    expectTypeOf<Product["id"]>().toEqualTypeOf<string>();
    expectTypeOf<Product["priceCents"]>().toEqualTypeOf<number>();
    expectTypeOf<Product["rating"]>().toEqualTypeOf<number | null>();
    expectTypeOf<Product["available"]>().toEqualTypeOf<boolean>();
    expectTypeOf<Product["releasedOn"]>().toEqualTypeOf<string | null>();
    expectTypeOf<Product["tagline"]>().toEqualTypeOf<string | null>();
  });

  test("a Model built from it round-trips every type against D1, defaults included", async () => {
    const db = connect(binding);
    const user = await db.model(User).createOrThrow({ email: "ada@example.com" });
    const built = db.model(Product).build({ userId: user.id, name: "Lamp", priceCents: 4500 });

    // Generated defaults show on a new record, as Rails' column defaults do.
    expect([built.available, built.tagline, typeof built.id]).toEqual([true, "New!", "string"]);
    await built.update({
      rating: 4.5,
      settings: { colour: "brass", sizes: [1, 2] },
      releasedOn: "2026-01-02",
    });

    const read = await db.model(Product).find(built.id);
    expect(read.attributes()).toEqual({
      id: built.id,
      userId: user.id,
      name: "Lamp",
      priceCents: 4500,
      rating: 4.5,
      available: true,
      settings: { colour: "brass", sizes: [1, 2] },
      releasedOn: "2026-01-02",
      createdAt: expect.any(Date),
      updatedAt: expect.any(Date),
      tagline: "New!",
    });
    expect((await read.user())?.isAdmin).toBe(false);
  });

  test("overrides change a Model's types and defaults, and an ignored column is never read or written", async () => {
    const events: QueryEvent[] = [];
    const db = connect(binding, { onQuery: (event) => events.push(event) });
    const user = await db.model(User).createOrThrow({ email: "grace@example.com" });
    const listing = db.model(Listing).build({ userId: user.id, name: "Desk", priceCents: 9900 });
    expectTypeOf<Listing["available"]>().toEqualTypeOf<number>();
    expectTypeOf<Listing["tagline"]>().toEqualTypeOf<string>();
    // A new type drops the generated default (`true`, for a boolean): the column's applies (#81).
    expect(listing.available).toBeNull();

    events.length = 0;
    await listing.save();
    const read = await db.model(Listing).find(listing.id);

    expect([read.available, read.tagline]).toEqual([1, "Listed"]);
    expect(read.attributes()).not.toHaveProperty("settings");
    expect(statementKinds(events)).toEqual(["INSERT", "SELECT"]);
    expect(events.map((event) => event.sql).join()).not.toContain("settings");
  });

  test("an ignored column is never read through a subclass of the Model that ignores it", async () => {
    class Featured extends Listing {}
    const events: QueryEvent[] = [];
    const db = connect(binding, { onQuery: (event) => events.push(event) });
    const user = await db.model(User).createOrThrow({ email: "edsger@example.com" });
    const featured = await db
      .model(Featured)
      .createOrThrow({ userId: user.id, name: "Chair", priceCents: 12000 });

    const inserted = events.map((event) => event.sql);
    events.length = 0;
    const read = await db.model(Featured).find(featured.id);

    expect(read.attributes()).not.toHaveProperty("settings");
    expect(statementKinds(events)).toEqual(["SELECT"]);
    expect([...inserted, ...events.map((event) => event.sql)].join()).not.toContain("settings");
  });

  test("a Model declared in full works beside the generated ones", async () => {
    const db = connect(binding);

    const visit = await db.model(Visit).createOrThrow({ path: "/" });

    expect(Visit.table).toBe("visits");
    expect((await db.model(Visit).find(visit.id)).path).toBe("/");
  });

  test("what ApplicationRecord declares, every Model has: a method, a scope, and a callback that runs first", async () => {
    class Note extends Product {
      static {
        this.beforeSave(() => console.log("Note's own"));
      }
    }
    const logged = vi.spyOn(console, "log").mockImplementation(() => {});
    const db = connect(binding);

    const user = await db.model(User).createOrThrow({ email: "linus@example.com" });
    await db.model(Note).createOrThrow({ userId: user.id, name: "Pen", priceCents: 150 });
    await db.model(Visit).createOrThrow({ path: "/notes" });
    // The callbacks' lines; the base class's onQuery logs each query too (checked below).
    const calls = logged.mock.calls.map(([line]) => String(line));
    const lines = calls.filter((line) => !/ \d+\.\dms /.test(line));
    expect(calls.some((line) => /^User \d+\.\dms INSERT INTO "users"/.test(line))).toBe(true);
    logged.mockRestore();

    expect(lines).toEqual(["Saving User", "Saving Note", "Note's own", "Saving Visit"]);
    expectTypeOf<User["label"]>().toEqualTypeOf<() => string>();
    expect(user.label()).toMatch(/^User \{"id":".+","email":"linus@example.com"/);
    expect((await db.model(Product).newest().first())?.name).toBe("Pen");
    expect((await db.model(User).newest().first())?.email).toBe("linus@example.com");
  });
});
