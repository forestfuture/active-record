import { Model } from "@forestfuture/arbor";
import { schema } from "../db/schema";

export abstract class ApplicationRecord extends Model {
  static override schema = schema;
}
