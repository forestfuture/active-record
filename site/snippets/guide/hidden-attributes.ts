import { Model } from "@forestfuture/active-record";

// #region base
// src/models/application-record.ts
export class Base extends Model {
  static override hiddenAttributes = ["passwordDigest"];
}
// #endregion base

// #region extend
export class Account extends Model.define({
  id: "integer",
  passwordDigest: "string",
  apiKey: "string",
}) {
  // A Model's list replaces the base class's, so repeat what you still want hidden:
  static override hiddenAttributes = [...Base.hiddenAttributes, "apiKey"];
}
// #endregion extend
