import { sendWelcomeEmail } from "../mail";
import { ApplicationRecord } from "./application-record";

export class User extends ApplicationRecord {
  static {
    this.afterCreateCommit(async (user) => {
      await sendWelcomeEmail(user.email);
    });
  }
}
