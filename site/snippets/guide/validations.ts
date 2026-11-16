import { hasMany, Model } from "@forestfuture/active-record";

// #region validates
export class Account extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  handle: { type: "string", null: false },
  plan: "string",
  seats: "integer",
  website: "string",
  isCompany: "boolean",
  companyName: "string",
}) {
  static {
    this.validates("email", { presence: true, uniqueness: { caseSensitive: false } });
    this.validates("handle", { length: { minimum: 3, maximum: 30 }, format: /^[a-z0-9_]+$/ });
    this.validates("plan", { inclusion: ["free", "team", "enterprise"] });
    this.validates("seats", { numericality: { onlyInteger: true, greaterThan: 0 } });
    this.validates("website", { format: /^https:\/\//, allowNull: true });
    this.validates("companyName", {
      presence: true,
      if: (account) => account.isCompany === true,
      message: "is required for a company",
    });
  }
}
// #endregion validates

// #region comparison
export class Event extends Model.define({
  id: { type: "integer", null: false },
  startsAt: { type: "datetime", null: false },
  endsAt: { type: "datetime", null: false },
}) {
  static {
    this.validates("endsAt", { comparison: { greaterThan: (event) => event.startsAt } });
  }
}
// #endregion comparison

// #region strict
export class Invoice extends Model.define({
  id: { type: "integer", null: false },
  total: { type: "integer", null: false },
  currency: { type: "string", null: false },
}) {
  static {
    this.validates("currency", { inclusion: ["USD", "EUR"], strict: true });
  }
}
// #endregion strict

// #region associated
export class Track extends Model.define({
  id: { type: "integer", null: false },
  playlistId: { type: "integer", null: false },
  title: { type: "string", null: false },
}) {
  static {
    this.validates("title", { presence: true });
  }
}

export class Playlist extends Model.define({
  id: { type: "integer", null: false },
  name: { type: "string", null: false },
}) {
  tracks = hasMany(Track);

  static {
    this.validatesAssociated("tracks");
  }
}
// #endregion associated

// #region custom
export class Booking extends Model.define({
  id: { type: "integer", null: false },
  startsAt: { type: "datetime", null: false },
  endsAt: { type: "datetime", null: false },
}) {
  static {
    this.errorMessages({ onTheHour: "must be on the hour" });

    this.afterValidation((booking) => {
      if (booking.startsAt.getUTCMinutes() !== 0) {
        booking.errors.add("startsAt", { type: "onTheHour" });
      }
      if (booking.startsAt.getUTCDay() === 0) {
        booking.errors.add("base", "The room is closed on Sundays");
      }
    });
  }
}
// #endregion custom

export async function addExample() {
  // #region add
  const startsAt = new Date("2026-05-03T10:30:00Z"); // a Sunday
  const endsAt = new Date("2026-05-03T11:30:00Z");
  const booking = Booking.build({ startsAt, endsAt });
  await booking.isValid(); // false

  booking.errors.toArray();
  // [{ attribute: "startsAt", type: "onTheHour", message: "must be on the hour" },
  //  { attribute: "base", type: "invalid", message: "The room is closed on Sundays" }]
  booking.errors.fullMessages(); // ["Starts at must be on the hour", "The room is closed on Sundays"]
  // #endregion add
  return booking;
}

export async function errorsExample() {
  // #region errors
  const account = Account.build({ email: "", handle: "a!" });
  await account.isValid(); // false

  account.errors.get("email"); // ["can't be blank"]
  account.errors.fullMessages(); // ["Email can't be blank", "Handle is too short (minimum is 3 characters)", …]
  account.errors.toArray(); // [{ attribute: "email", type: "blank", message: "can't be blank" }, …]
  console.log(account.errors.size); // 5
  // #endregion errors
  return account;
}
