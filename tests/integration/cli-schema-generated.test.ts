import { readdirSync, readFileSync } from "node:fs";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, expectTypeOf, test, vi } from "vite-plus/test";
import { runSchema } from "../../packages/active-record/cli/schema/command.ts";
import { connect, type QueryEvent } from "../../packages/d1-record/src/index.ts";
import { Listing } from "../fixtures/schema-project/src/models/listing.ts";
import { Product } from "../fixtures/schema-project/src/models/product.ts";
import { User } from "../fixtures/schema-project/src/models/user.ts";
import { Visit } from "../fixtures/schema-project/src/models/visit.ts";

const projectDir = new URL("../fixtures/schema-project/", import.meta.url).pathname;

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

  test("types each attribute from its column", () => {
    expectTypeOf<Product["id"]>().toEqualTypeOf<string>();
    expectTypeOf<Product["priceCents"]>().toEqualTypeOf<number>();
    expectTypeOf<Product["rating"]>().toEqualTypeOf<number | null>();
    expectTypeOf<Product["available"]>().toEqualTypeOf<boolean>();
    expectTypeOf<Product["releasedOn"]>().toEqualTypeOf<Date | null>();
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
      releasedOn: new Date("2026-01-02T00:00:00.000Z"),
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
      releasedOn: new Date("2026-01-02T00:00:00.000Z"),
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
    expect(events.map((event) => event.sql)).toEqual([
      expect.stringMatching(/^INSERT INTO "products" .* RETURNING "id", "user_id", "name"/),
      expect.stringMatching(/^SELECT "id", "user_id", "name", .*"tagline" FROM "products"/),
    ]);
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
    expect(events.map((event) => event.sql)).toEqual([
      expect.stringMatching(/^SELECT "id", "user_id", "name", .*"tagline" FROM "products"/),
    ]);
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
