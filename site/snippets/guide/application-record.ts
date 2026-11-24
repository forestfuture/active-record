import { Model } from "@forestfuture/arbor";
import { schema } from "../db/schema";

// The app's base class, as `arbor schema` writes it, for the guide's Models.
export abstract class ApplicationRecord extends Model {
  static override schema = schema;
}
