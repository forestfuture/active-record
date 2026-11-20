import { belongsTo, hasOne } from "@forestfuture/active-record";
import { ApplicationRecord } from "./application-record";
import { Article } from "./article";
import { Author } from "./author";
import { Tag } from "./tag";

export class Tagging extends ApplicationRecord {
  article = belongsTo(Article);
  tag = belongsTo(Tag);
  author = hasOne(Author, { through: "article" }); // the article's author
}
