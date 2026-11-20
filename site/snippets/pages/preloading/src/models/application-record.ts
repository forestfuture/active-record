import { Model } from "@forestfuture/active-record";
import { schema } from "../db/schema";

export abstract class ApplicationRecord extends Model {
  static override schema = schema;
}
