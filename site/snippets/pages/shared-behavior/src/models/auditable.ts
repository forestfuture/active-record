import { ApplicationRecord } from "./application-record";

// Shared by only the Models that extend it. It has no table of its own.
export abstract class Auditable extends ApplicationRecord {
  static override abstract = true;

  static {
    this.afterSave((record) => {
      console.log(`Saved ${record.constructor.name}`);
    });
  }
}
