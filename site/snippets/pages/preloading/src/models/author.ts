import { hasMany, hasOne } from "@forestfuture/arbor";
import { ApplicationRecord } from "./application-record";
import { Article } from "./article";
import { Profile } from "./profile";

export class Author extends ApplicationRecord {
  articles = hasMany(Article);
  profile = hasOne(Profile);
}
