// The fixture's Profile, a generated Model that belongs to a User (#232).
import { belongsTo } from "../../../packages/active-record/src/index.ts";
import { DbRecord } from "./db-record.ts";
import { User } from "./user.ts";

export class Profile extends DbRecord {
  user = belongsTo(User);
}
