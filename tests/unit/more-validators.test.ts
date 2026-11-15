import { describe, expect, test } from "vite-plus/test";
import { Model, type Errors } from "../../packages/active-record/src/index.ts";
import { connect } from "../../packages/active-record/src/adapters/d1/index.ts";

/** Validates `record`, returning its errors as `attribute type: message`. */
async function errorsOf(record: { isValid(): Promise<boolean>; errors: Errors }) {
  await record.isValid();
  return record.errors
    .toArray()
    .map(({ attribute, type, message }) => `${attribute} ${type}: ${message}`);
}

describe("exclusion", () => {
  class Handle extends Model.define({
    id: "integer",
    name: "string",
    slug: "string",
    nick: "string",
  }) {
    static table = "handles";
    static {
      this.validates("name", { exclusion: ["admin", "root"] });
      this.validates("slug", { exclusion: { in: ["new", null] } });
      this.validates("nick", { exclusion: ["admin"], allowNull: true });
    }
  }
  const handles = connect({} as never).model(Handle);

  test("passes a value outside the list, and null unless the list holds it", async () => {
    expect(await errorsOf(handles.build({ name: "ada", slug: "ada", nick: null }))).toEqual([]);
    expect(await errorsOf(handles.build({ name: null, slug: "ada", nick: "ada" }))).toEqual([]);
  });

  test("fails a value in the list as reserved, in either form", async () => {
    const handle = handles.build({ name: "admin", slug: "new", nick: "ada" });

    expect(await errorsOf(handle)).toEqual([
      "name exclusion: is reserved",
      "slug exclusion: is reserved",
    ]);
  });

  test("skips null with allowNull, and fails null when the list holds it", async () => {
    const handle = handles.build({ name: "ada", slug: null, nick: null });

    expect(await errorsOf(handle)).toEqual(["slug exclusion: is reserved"]);
  });
});

describe("absence", () => {
  class Signup extends Model.define({ id: "integer", trap: "string", flagged: "boolean" }) {
    static table = "signups";
    static {
      this.validates("trap", { absence: true });
      this.validates("flagged", { absence: true });
    }
  }
  const signups = connect({} as never).model(Signup);

  test("passes null and a string that's only whitespace", async () => {
    expect(await errorsOf(signups.build({ trap: null, flagged: null }))).toEqual([]);
    expect(await errorsOf(signups.build({ trap: "  ", flagged: null }))).toEqual([]);
  });

  test("fails any other value as must be blank, false included", async () => {
    const signup = signups.build({ trap: "bot", flagged: false });

    expect(await errorsOf(signup)).toEqual([
      "trap present: must be blank",
      "flagged present: must be blank",
    ]);
  });
});

describe("comparison with a value", () => {
  const launch = new Date(Date.UTC(2026, 0, 1));
  class Listing extends Model.define({
    id: "integer",
    price: "real",
    stock: "integer",
    code: "string",
    opensAt: "datetime",
  }) {
    static table = "listings";
    static {
      this.validates("price", { comparison: { greaterThan: 0, lessThanOrEqualTo: 100 } });
      this.validates("stock", { comparison: { greaterThanOrEqualTo: 1, lessThan: 10 } });
      this.validates("code", { comparison: { otherThan: "none", greaterThan: "B" } });
      this.validates("opensAt", { comparison: { equalTo: launch } });
    }
  }
  const listings = connect({} as never).model(Listing);
  const valid = { price: 5, stock: 3, code: "C1", opensAt: new Date(launch.getTime()) };

  test("passes values that meet every bound, a Date equal to another by its time", async () => {
    expect(await errorsOf(listings.build(valid))).toEqual([]);
  });

  test("fails each bound a number misses, with numericality's messages", async () => {
    expect(await errorsOf(listings.build({ ...valid, price: 0, stock: 10 }))).toEqual([
      "price greaterThan: must be greater than 0",
      "stock lessThan: must be less than 10",
    ]);
    expect(await errorsOf(listings.build({ ...valid, price: 101, stock: 0 }))).toEqual([
      "price lessThanOrEqualTo: must be less than or equal to 100",
      "stock greaterThanOrEqualTo: must be greater than or equal to 1",
    ]);
  });

  test("compares strings in JavaScript's order, and otherThan fails an equal value", async () => {
    expect(await errorsOf(listings.build({ ...valid, code: "A9" }))).toEqual([
      "code greaterThan: must be greater than B",
    ]);
    expect(await errorsOf(listings.build({ ...valid, code: "none" }))).toEqual([
      "code otherThan: must be other than none",
    ]);
  });

  test("equalTo fails a different Date, showing the bound as an ISO string", async () => {
    const listing = listings.build({ ...valid, opensAt: new Date(Date.UTC(2026, 0, 2)) });

    expect(await errorsOf(listing)).toEqual([
      "opensAt equalTo: must be equal to 2026-01-01T00:00:00.000Z",
    ]);
  });
});

describe("comparison with a function of the record", () => {
  class Booking extends Model.define({ id: "integer", startsAt: "datetime", endsAt: "datetime" }) {
    static table = "bookings";
    static {
      this.validates("endsAt", { comparison: { greaterThan: (booking) => booking.startsAt } });
    }
  }
  const bookings = connect({} as never).model(Booking);
  const startsAt = new Date(Date.UTC(2026, 2, 1));

  test("compares with what the function returns for the record being validated", async () => {
    const valid = bookings.build({ startsAt, endsAt: new Date(Date.UTC(2026, 2, 4)) });
    const invalid = bookings.build({ startsAt, endsAt: new Date(startsAt.getTime()) });

    expect(await errorsOf(valid)).toEqual([]);
    expect(await errorsOf(invalid)).toEqual([
      "endsAt greaterThan: must be greater than 2026-03-01T00:00:00.000Z",
    ]);
  });
});
