import { RecordNotUnique } from "@forestfuture/active-record";
import type { User } from "./models";

export async function saveOrReportTaken(user: User): Promise<void> {
  // #region not-unique
  try {
    await user.save();
  } catch (error) {
    if (error instanceof RecordNotUnique && error.attributes.includes("email")) {
      user.errors.add("email", "has already been taken", { type: "taken" });
    } else {
      throw error;
    }
  }
  // #endregion not-unique
}
