import { hasMany } from "@forestfuture/active-record";
import { ApplicationRecord } from "./application-record";
import { Article } from "./article";

export class Author extends ApplicationRecord {
  articles = hasMany(Article);
}
