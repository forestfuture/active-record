import { ApplicationRecord } from "./application-record";

export class Booking extends ApplicationRecord {
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
