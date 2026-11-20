import { Model, type QueryListener } from "@forestfuture/active-record";
import { schema } from "../db/schema";

export abstract class ApplicationRecord extends Model {
  static override schema = schema;

  // Every query, from every Model, whichever database runs it.
  static override onQuery: QueryListener = ({ model, sql, durationMs, error }) => {
    console.log(`${model} ${durationMs.toFixed(1)}ms ${sql}`, error ?? "");
  };

  // The defaults, plus an IBAN and a date of birth.
  static override filterAttributes = [...Model.filterAttributes, "iban", /^dateOfBirth$/];
}
