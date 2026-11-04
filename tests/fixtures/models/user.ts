// The fixture's User, a generated Model with a hasMany and a hasOne (#232).
import { hasMany, hasOne } from "../../../packages/active-record/src/index.ts";
import { Post } from "./post.ts";
import { Profile } from "./profile.ts";
import { DbRecord } from "./db-record.ts";

export class User extends DbRecord {
  posts = hasMany(Post);
  profile = hasOne(Profile);
}
