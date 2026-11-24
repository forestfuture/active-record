import { Model } from "@forestfuture/arbor";
import { schema } from "../db/schema";

export abstract class ApplicationRecord extends Model {
  static override schema = schema;

  static override perPage = 20; // when paginate() isn't given a perPage
  static override maxPerPage = 50; // a larger perPage is capped at this
}
