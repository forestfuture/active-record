import { ApplicationRecord } from "./application-record";

export class Track extends ApplicationRecord {
  static {
    this.validates("title", { presence: true });
  }
}
