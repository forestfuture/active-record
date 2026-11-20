import { Model } from "@forestfuture/active-record";
import { schema } from "../db/schema";

export abstract class ApplicationRecord extends Model {
  static override schema = schema;

  // Left out of toJSON(), so Response.json(record) never sends them:
  static override hiddenAttributes = ["passwordDigest"];

  // Shown as [FILTERED] in logs, errors, and printed records: the defaults, and an IBAN.
  static override filterAttributes = [...Model.filterAttributes, "iban"];
}
