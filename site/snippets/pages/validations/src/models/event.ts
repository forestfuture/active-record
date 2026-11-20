import { ApplicationRecord } from "./application-record";

export class Event extends ApplicationRecord {
  static {
    this.validates("endsAt", { comparison: { greaterThan: (event) => event.startsAt } });
  }
}
