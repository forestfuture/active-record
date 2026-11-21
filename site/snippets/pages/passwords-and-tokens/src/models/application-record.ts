import { Model } from "@forestfuture/active-record";
import { schema } from "../db/schema";

export abstract class ApplicationRecord extends Model {
  static override schema = schema;

  // Left out of toJSON(), so Response.json(record) never sends a digest:
  static override hiddenAttributes = ["passwordDigest"];
}
