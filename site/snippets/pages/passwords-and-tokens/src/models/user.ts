import { ApplicationRecord } from "./application-record";

export class User extends ApplicationRecord {
  static override attributes = {
    password: { securePassword: true }, // kept in password_digest
    authToken: { secureToken: true }, // a random token for each new user
  } as const;

  static {
    this.normalizes("email", { with: (email) => email.trim().toLowerCase() });
  }
}
