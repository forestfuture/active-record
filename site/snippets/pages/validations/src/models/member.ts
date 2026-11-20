import { ApplicationRecord } from "./application-record";

export class Member extends ApplicationRecord {
  static validationContexts = ["signup"] as const;

  static {
    this.validates("email", { format: /@/ });
    this.validates("password", { presence: true, on: "create" });
    this.validates("inviteCode", { presence: true, on: "signup" });
  }
}
