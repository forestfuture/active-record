import { ApplicationRecord } from "./application-record";

export class User extends ApplicationRecord {
  static {
    // After a save, the record is clean: read what the save changed.
    this.afterSave((user) => {
      const change = user.savedChangeTo("email");
      if (change) console.log(`Email changed from ${change[0]} to ${change[1]}`);
    });
  }
}
