import { ApplicationRecord } from "./application-record";

export class Account extends ApplicationRecord {
  static override table = "billing_accounts"; // in place of accounts
}
