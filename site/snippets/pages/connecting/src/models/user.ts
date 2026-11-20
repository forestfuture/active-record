import { hasMany } from "@forestfuture/active-record";
import { ApplicationRecord } from "./application-record";
import { Post } from "./post";

export class User extends ApplicationRecord {
  posts = hasMany(Post);
}
