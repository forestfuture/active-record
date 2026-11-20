import { ApplicationRecord } from "./application-record";

export class Account extends ApplicationRecord {
  // A Model's list replaces the base class's, so repeat what you still want hidden:
  static override hiddenAttributes = [...ApplicationRecord.hiddenAttributes, "apiKey"];
}
