import { Model } from "@forestfuture/active-record";
import { schema } from "../db/schema";

// The app's base class, as `active-record schema` writes it, for the guide's Models.
export abstract class ApplicationRecord extends Model {
  static override schema = schema;
}
