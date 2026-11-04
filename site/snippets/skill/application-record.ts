import { Model } from "@forestfuture/active-record";
import { schema } from "./schema";

/**
 * The base class for this app's Models: `class Product extends ApplicationRecord {}`. Methods,
 * callbacks and scopes written here are shared by every Model, as in Rails' ApplicationRecord.
 * It's abstract: it has no table of its own.
 */
export abstract class ApplicationRecord extends Model {
  // The generated schema: each Model's attributes, from its table, and the D1 binding Models
  // query (Product.find(id)), from your Wrangler config's d1_databases.
  static override schema = schema;

  // A method every record has:
  // label() {
  //   return `${this.constructor.name} ${JSON.stringify(this.attributes())}`;
  // }

  // A scope every Model has, in SQL since it runs on each Model's own table (import sql too):
  // static newest = this.scope((q) => q.order(sql`created_at DESC`));

  // Log every query, from every Model, in production too (import type QueryListener too; the
  // guide's Connecting page shows development-only logging, and one request's queries):
  // static override onQuery: QueryListener = ({ model, sql, durationMs }) =>
  //   console.log(`${model} ${durationMs.toFixed(1)}ms ${sql}`);

  // Values of attributes named like these show as "[FILTERED]" to onQuery and in errors. These
  // are Rails' defaults (passwords, tokens, keys, emails…); add yours, or leave one out:
  // static override filterAttributes = [...Model.filterAttributes, "iban"];

  // Attributes toJSON() leaves out, so Response.json(record) never sends them (exact names;
  // attributes() still has them):
  // static override hiddenAttributes = ["passwordDigest"];

  // How new TEXT keys are made (a UUID by default), e.g. time-ordered ones from a
  // library you choose:
  // static override generateId = () => uuidv7();

  static {
    // A callback that runs for every Model, before each Model's own:
    // this.beforeSave((record) => {
    //   console.log(`Saving ${record.constructor.name}`);
    // });
    // Error messages in place of the built-in English, for every Model (a Model can declare
    // its own, and attributes: { email: { … } } is for one attribute):
    // this.errorMessages({ blank: "is required" });
  }
}
