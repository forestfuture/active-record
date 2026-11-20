import { Model } from "@forestfuture/active-record";
import { schema } from "../db/schema";

export abstract class ApplicationRecord extends Model {
  static override schema = schema;

  static {
    // Messages and names for every Model, in place of the built-in English:
    this.errorMessages({
      tooShort: {
        one: "needs at least 1 character",
        other: "needs at least %{count} characters",
      },
    });
    this.humanAttributeNames({ createdAt: "Added on" });
  }
}
