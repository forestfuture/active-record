import { ApplicationRecord } from "./application-record";

export class Account extends ApplicationRecord {
  static override table = "billing_accounts"; // in place of accounts
  static override attributes = {
    termsOfService: { type: "boolean", virtual: true }, // a form's checkbox, never a column
  } as const;

  static {
    this.normalizes("email", { with: (email) => email.trim().toLowerCase() });
  }
}
