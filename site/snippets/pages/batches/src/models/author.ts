import { hasMany } from "@forestfuture/arbor";
import { ApplicationRecord } from "./application-record";
import { Article } from "./article";

export class Author extends ApplicationRecord {
  articles = hasMany(Article, { dependent: "destroy" });
}
