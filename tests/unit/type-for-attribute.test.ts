import { describe, expect, test } from "vite-plus/test";
import {
  Model,
  UnknownAttribute,
  type TableAttributes,
} from "../../packages/active-record/src/index.ts";
import { d1 } from "../../packages/d1-record/src/index.ts";

// One attribute per stored form. `secret` is filtered by default.
class Post extends Model.define({
  id: { type: "integer", null: false },
  publishedAt: { type: "datetime", column: "published_at" },
  seconds: { type: "datetime", storage: "unixSeconds" },
  milliseconds: { type: "datetime", storage: "unixMilliseconds" },
  featured: "boolean",
  rating: "integer",
  meta: "json",
  secret: "json",
}) {
  static table = "typed_posts";
}

// A generated Model, with an override, on an app's base class holding its schema.
const notes = { id: { type: "integer", null: false }, openedAt: "integer" } as const;
abstract class ApplicationRecord extends Model {
  static override schema = {
    adapter: d1({ binding: "DB" }),
    tables: { notes: { attributes: notes, primaryKey: "id" } },
    models: { Note: "notes" },
  } as const;
}
// The interface stands in for the declarations active-record schema generates in another file.
/* oxlint-disable typescript/no-unsafe-declaration-merging */
class Note extends ApplicationRecord {
  static override attributes = { openedAt: { type: "datetime", storage: "unixSeconds" } } as const;
}
interface Note extends TableAttributes<typeof notes, (typeof Note)["attributes"]> {}
/* oxlint-enable typescript/no-unsafe-declaration-merging */

const instant = new Date("2026-01-02T03:04:05.678Z");

// No D1 needed: these conversions never query (#148).
describe("typeForAttribute's conversions need no database", () => {
  describe("serialize", () => {
    test("floors a Date to the second for unixSeconds", () => {
      expect(Post.typeForAttribute("seconds").serialize(instant)).toBe(1767323045);
    });

    test("keeps milliseconds for unixMilliseconds", () => {
      expect(Post.typeForAttribute("milliseconds").serialize(instant)).toBe(1767323045678);
    });

    test("casts an ISO string first, so it's written as the attribute stores it", () => {
      expect(Post.typeForAttribute("seconds").serialize("2026-01-02T03:04:05Z")).toBe(1767323045);
      expect(Post.typeForAttribute("publishedAt").serialize("2026-01-02")).toBe(
        "2026-01-02T00:00:00.000Z",
      );
    });

    test("gives NULL for null", () => {
      expect(Post.typeForAttribute("seconds").serialize(null)).toBeNull();
      expect(Post.typeForAttribute("meta").serialize(null)).toBeNull();
    });

    test("throws for a number given to a datetime, as assigning it would", () => {
      expect(() => Post.typeForAttribute("seconds").serialize(1767323045)).toThrow(
        new TypeError(`Post: 1767323045 isn't a datetime for "seconds"`),
      );
    });

    test("throws for text that isn't an integer", () => {
      expect(() => Post.typeForAttribute("rating").serialize("abc")).toThrow(
        new TypeError(`Post: "abc" isn't an integer for "rating"`),
      );
    });

    test("hides a filtered attribute's value in the error", () => {
      expect(() => Post.typeForAttribute("secret").serialize(10n)).toThrow(
        new TypeError(`Post: [FILTERED] isn't a JSON value for "secret"`),
      );
    });
  });

  describe("cast", () => {
    test("gives the JavaScript value an assignment would", () => {
      expect(Post.typeForAttribute("seconds").cast("2026-01-02T03:04:05Z")).toEqual(
        new Date("2026-01-02T03:04:05.000Z"),
      );
      expect(Post.typeForAttribute("rating").cast(" 42 ")).toBe(42);
      expect(Post.typeForAttribute("featured").cast("off")).toBe(false);
    });

    test("keeps a Date's milliseconds, even for unixSeconds", () => {
      expect(Post.typeForAttribute("seconds").cast(instant)).toEqual(instant);
    });

    test("leaves null as null", () => {
      expect(Post.typeForAttribute("rating").cast(null)).toBeNull();
    });

    test("throws for a boolean it can't read", () => {
      expect(() => Post.typeForAttribute("featured").cast("yes")).toThrow(
        new TypeError(`Post: "yes" isn't a boolean for "featured"`),
      );
    });
  });

  describe.each(["serialize", "cast"] as const)("%s", (method) => {
    test("refuses undefined, as assigning does", () => {
      expect(() => Post.typeForAttribute("seconds")[method](undefined)).toThrow(
        new TypeError(`Post: got undefined for "seconds"; use null to store NULL`),
      );
    });
  });

  describe("deserialize", () => {
    test("gives null for NULL and for undefined", () => {
      expect(Post.typeForAttribute("seconds").deserialize(null)).toBeNull();
      expect(Post.typeForAttribute("seconds").deserialize(undefined)).toBeNull();
    });

    test("throws for text in a Unix time column", () => {
      expect(() => Post.typeForAttribute("seconds").deserialize("abc")).toThrow(
        new TypeError(`Post: "abc" isn't a datetime for "seconds"`),
      );
    });

    test("throws for text in a json column that isn't JSON", () => {
      expect(() => Post.typeForAttribute("meta").deserialize("not json {")).toThrow(
        new TypeError(`Post: "not json {" isn't a JSON value for "meta"`),
      );
    });

    test("hides a filtered attribute's cell in the error", () => {
      expect(() => Post.typeForAttribute("secret").deserialize("not json {")).toThrow(
        new TypeError(`Post: [FILTERED] isn't a JSON value for "secret"`),
      );
    });
  });

  describe("the object", () => {
    test("throws UnknownAttribute for a name the Model doesn't have", () => {
      expect(() => Post.typeForAttribute("nope" as never)).toThrow(
        new UnknownAttribute(`Post has no attribute "nope"`),
      );
    });

    test("has methods that work on their own", () => {
      const { serialize } = Post.typeForAttribute("seconds");

      expect(serialize(instant)).toBe(1767323045);
    });

    test("is there on a generated Model, with its overrides", () => {
      const { serialize, deserialize } = Note.typeForAttribute("openedAt");

      expect(serialize(instant)).toBe(1767323045);
      expect(deserialize(1767323045)).toEqual(new Date("2026-01-02T03:04:05.000Z"));
    });
  });
});
