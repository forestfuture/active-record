import { Model } from "@forestfuture/active-record";

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

// #region custom
export class Booking extends Model.define({
  id: { type: "integer", null: false },
  startsAt: { type: "datetime", null: false },
  endsAt: { type: "datetime", null: false },
}) {
  static {
    this.errorMessages({ afterStart: "must be after the start" });

    this.afterValidation((booking) => {
      if (booking.endsAt <= booking.startsAt) {
        booking.errors.add("endsAt", { type: "afterStart" });
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
  const sunday = new Date("2026-05-03T10:00:00Z");
  const booking = Booking.build({ startsAt: sunday, endsAt: sunday });
  await booking.isValid(); // false

  booking.errors.toArray();
  // [{ attribute: "endsAt", type: "afterStart", message: "must be after the start" },
  //  { attribute: "base", type: "invalid", message: "The room is closed on Sundays" }]
  booking.errors.fullMessages(); // ["Ends at must be after the start", "The room is closed on Sundays"]
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
