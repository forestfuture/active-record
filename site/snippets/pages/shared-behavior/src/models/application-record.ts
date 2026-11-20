import { Model, sql } from "@forestfuture/active-record";
import { schema } from "../db/schema";

// What's written on ApplicationRecord, every Model has.
export abstract class ApplicationRecord extends Model {
  static override schema = schema;

  static newest = this.scope((q) => q.order(sql`created_at DESC`));

  label() {
    return `${this.constructor.name} ${JSON.stringify(this.attributes())}`;
  }

  static {
    this.beforeSave((record) => {
      console.log(`Saving ${record.constructor.name}`); // before each Model's own callbacks
    });
  }
}
