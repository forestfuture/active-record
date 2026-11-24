import { hasOne } from "@forestfuture/arbor";
import { ApplicationRecord } from "./application-record";
import { Profile } from "./profile";

export class User extends ApplicationRecord {
  profile = hasOne(Profile, { touch: true }); // sets the profile's updatedAt
}
