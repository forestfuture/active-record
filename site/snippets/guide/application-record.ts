import { Model } from "@forestfuture/active-record";
import { schema } from "../db/schema";

// #region shared
// What's written on ApplicationRecord, every Model has.
export abstract class ApplicationRecord extends Model {
  static override schema = schema;

  label() {
    return `${this.constructor.name} ${JSON.stringify(this.attributes())}`;
  }

  static {
    this.beforeSave((record) => {
      console.log(`Saving ${record.constructor.name}`); // before each Model's own callbacks
    });
  }
}

// Every Model built on it has label(), and ApplicationRecord's beforeSave.
export class Account extends ApplicationRecord {
  static override table = "billing_accounts";
}
// #endregion shared
