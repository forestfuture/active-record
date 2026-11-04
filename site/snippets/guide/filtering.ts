import { Model } from "@forestfuture/active-record";

// #region add
// src/models/application-record.ts
export class Base extends Model {
  // Rails' defaults, plus an IBAN and a date of birth:
  static override filterAttributes = [...Model.filterAttributes, "iban", /^dateOfBirth$/];
}
// #endregion add
