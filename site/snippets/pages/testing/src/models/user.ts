import { ApplicationRecord } from "./application-record";

export class User extends ApplicationRecord {
  static {
    this.beforeValidation((user) => {
      user.email = user.email.toLowerCase();
    });
  }
}
