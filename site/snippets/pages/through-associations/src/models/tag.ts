import { hasMany } from "@forestfuture/active-record";
import { ApplicationRecord } from "./application-record";
import { Article } from "./article";
import { Author } from "./author";
import { Tagging } from "./tagging";

export class Tag extends ApplicationRecord {
  taggings = hasMany(Tagging);
  articles = hasMany(Article, { through: "taggings" }); // each tagging's article
  writers = hasMany(Author, { through: "articles", source: "author" }); // each article's author
}
