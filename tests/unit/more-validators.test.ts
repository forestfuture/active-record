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

describe("comparison with null, and values it can't compare", () => {
  class Shift extends Model.define({
    id: "integer",
    startsAt: "datetime",
    endsAt: "datetime",
    breakAt: "datetime",
  }) {
    static table = "shifts";
    static {
      this.validates("endsAt", {
        comparison: { greaterThan: (shift) => shift.startsAt, otherThan: (shift) => shift.breakAt },
      });
      this.validates("breakAt", {
        comparison: { greaterThan: (shift) => shift.startsAt },
        allowNull: true,
      });
    }
  }
  const shifts = connect({} as never).model(Shift);
  const startsAt = new Date(Date.UTC(2026, 2, 1, 9));
  const endsAt = new Date(Date.UTC(2026, 2, 1, 17));

  test("a null value is blank, once for all its bounds, unless allowNull", async () => {
    const shift = shifts.build({ startsAt, endsAt: null, breakAt: null });

    expect(await errorsOf(shift)).toEqual(["endsAt blank: can't be blank"]);
  });

  test("a string that's only whitespace is blank, as null is", async () => {
    class Grade extends Model.define({ id: "integer", letter: "string" }) {
      static table = "grades";
      static {
        this.validates("letter", { comparison: { lessThanOrEqualTo: "F" } });
      }
    }
    const grade = connect({} as never)
      .model(Grade)
      .build({ letter: "  " });

    expect(await errorsOf(grade)).toEqual(["letter blank: can't be blank"]);
  });

  test("a bound that's null is skipped", async () => {
    const shift = shifts.build({ startsAt: null, endsAt, breakAt: null });

    expect(await errorsOf(shift)).toEqual([]);
  });

  test("a value of another type than its bound throws TypeError", async () => {
    class Rota extends Model.define({ id: "integer", startsAt: "datetime", hours: "integer" }) {
      static table = "rotas";
      static {
        this.validates("hours", { comparison: { lessThan: (rota) => rota.startsAt } });
      }
    }
    const rota = connect({} as never)
      .model(Rota)
      .build({ startsAt, hours: 8 });

    await expect(rota.isValid()).rejects.toThrow(
      new TypeError('Rota: "hours" (a number) can\'t be compared with a Date'),
    );
  });
});

describe("acceptance", () => {
  class Registration extends Model.define({
    id: "integer",
    terms: "boolean",
    privacy: "string",
    marketing: "string",
    adult: "boolean",
  }) {
    static table = "registrations";
    static {
      this.validates("terms", { acceptance: true });
      this.validates("privacy", { acceptance: true });
      this.validates("marketing", { acceptance: { accept: ["yes"] } });
      this.validates("adult", { acceptance: true, allowNull: false });
    }
  }
  const registrations = connect({} as never).model(Registration);

  test('passes true and "1" by default, a value it\'s told to accept, and null', async () => {
    const registration = registrations.build({
      terms: true,
      privacy: "1",
      marketing: "yes",
      adult: true,
    });
    const unanswered = registrations.build({
      terms: null,
      privacy: null,
      marketing: null,
      adult: true,
    });

    expect(await errorsOf(registration)).toEqual([]);
    expect(await errorsOf(unanswered)).toEqual([]);
  });

  test("fails any other value as must be accepted, and null with allowNull: false", async () => {
    const registration = registrations.build({
      terms: false,
      privacy: "0",
      marketing: "1",
      adult: null,
    });

    expect(await errorsOf(registration)).toEqual([
      "terms accepted: must be accepted",
      "privacy accepted: must be accepted",
      "marketing accepted: must be accepted",
      "adult accepted: must be accepted",
    ]);
  });
});

describe("the new rules within one validates call", () => {
  test("apply after inclusion and numericality, in a fixed order whatever the keys' order", async () => {
    class Seat extends Model.define({ id: "integer", row: "string", kept: "string" }) {
      static table = "seats";
      static {
        this.validates("row", {
          acceptance: { accept: ["A"] },
          comparison: { lessThan: "C" },
          exclusion: ["Z"],
          inclusion: ["A", "B"],
          absence: true,
          presence: true,
        });
      }
    }
    const seat = connect({} as never)
      .model(Seat)
      .build({ row: "Z" });

    expect(await errorsOf(seat)).toEqual([
      "row present: must be blank",
      "row inclusion: is not included in the list",
      "row exclusion: is reserved",
      "row lessThan: must be less than C",
      "row accepted: must be accepted",
    ]);
  });

  test("their options are typed, and a bound's function gets the Model's record", () => {
    const declare = () => {
      class Trip extends Model.define({
        id: "integer",
        leavesAt: "datetime",
        returnsAt: "datetime",
      }) {
        static table = "trips";
        static {
          // @ts-expect-error a comparison bound is named greaterThan, not after
          this.validates("returnsAt", { comparison: { after: (trip) => trip.leavesAt } });
          // @ts-expect-error a Trip has leavesAt, not leaves
          this.validates("returnsAt", { comparison: { greaterThan: (trip) => trip.leaves } });
          // @ts-expect-error acceptance takes true or { accept: [...] }
          this.validates("leavesAt", { acceptance: ["yes"] });
          // @ts-expect-error absence takes a boolean
          this.validates("leavesAt", { absence: "yes" });
        }
      }
      return Trip;
    };

    expect(declare).toBeTypeOf("function");
  });
});
