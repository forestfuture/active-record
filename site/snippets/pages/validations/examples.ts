import { Account } from "./src/models/account";
import { Booking } from "./src/models/booking";
import { Event } from "./src/models/event";
import { Invoice } from "./src/models/invoice";
import { Member } from "./src/models/member";
import { Playlist } from "./src/models/playlist";
import { Product } from "./src/models/product";

export async function checking() {
  // #region is-valid
  const account = Account.build({
    email: "jane@example.com",
    handle: "jane",
    plan: "free",
    seats: 1,
  });
  const valid = await account.isValid(); // true; async, since uniqueness asks the database
  // #endregion is-valid
  return valid;
}

export async function comparing() {
  // #region comparison
  const at = new Date("2026-05-01T10:00:00Z");
  const event = Event.build({ startsAt: at, endsAt: at });
  await event.isValid(); // false: "Ends at must be greater than 2026-05-01T10:00:00.000Z"
  // #endregion comparison
  return event;
}

export async function throwing() {
  // #region strict
  const invoice = Invoice.build({ total: 1200, currency: "GBP" });
  await invoice.isValid(); // throws StrictValidationFailed: "Currency is not included in the list"
  // #endregion strict
}

export async function signingUp() {
  // #region contexts
  const member = Member.build({ email: "jane@example.com", password: "secret" });
  await member.isValid("signup"); // false: invite code can't be blank
  member.inviteCode = "WELCOME";
  await member.save({ context: ["create", "signup"] }); // the create rules and the signup ones
  // #endregion contexts
  return member;
}

export async function validatingTracks() {
  // #region associated
  const playlist = Playlist.build({ name: "Road trip" });
  const track = playlist.tracks().build({ title: "" });
  await playlist.isValid(); // false: "Tracks is invalid"
  track.errors.fullMessages(); // ["Title can't be blank"]
  // #endregion associated
  return { playlist, track };
}

export async function readingErrors() {
  // #region errors
  const account = Account.build({ email: "", handle: "a!" });
  await account.isValid(); // false

  account.errors.get("email"); // ["can't be blank"]
  account.errors.fullMessages(); // ["Email can't be blank", "Handle needs at least 3 characters", …]
  account.errors.toArray(); // [{ attribute: "email", type: "blank", message: "can't be blank" }, …]
  console.log(account.errors.size); // 5
  // #endregion errors
  return account;
}

export async function addingErrors() {
  // #region add
  const startsAt = new Date("2026-05-03T10:30:00Z"); // a Sunday
  const booking = Booking.build({ startsAt, endsAt: new Date("2026-05-03T11:30:00Z") });
  await booking.isValid(); // false

  booking.errors.toArray();
  // [{ attribute: "startsAt", type: "onTheHour", message: "must be on the hour" },
  //  { attribute: "base", type: "invalid", message: "The room is closed on Sundays" }]
  booking.errors.fullMessages(); // ["Starts at must be on the hour", "The room is closed on Sundays"]
  // #endregion add
  return booking;
}

export async function readingMessages() {
  // #region messages
  const product = Product.build({ name: "", priceCents: 0 });
  await product.isValid(); // false

  product.errors.fullMessages();
  // ["Name needs a name customers will see",
  //  "Name needs at least 3 characters",
  //  "Price must be more than 0"]
  Product.humanAttributeName("priceCents"); // "Price"
  // #endregion messages
  return product;
}
