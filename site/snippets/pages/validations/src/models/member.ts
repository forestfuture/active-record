import { ApplicationRecord } from "./application-record";

export class Member extends ApplicationRecord {
  static override attributes = {
    emailConfirmation: { type: "string", virtual: true }, // typed a second time, never saved
  } as const;

  static validationContexts = ["signup"] as const;

  static {
    this.validates("email", { format: /@/, confirmation: true });
    this.validates("password", { presence: true, on: "create" });
    this.validates("inviteCode", { presence: true, on: "signup" });
  }
}
