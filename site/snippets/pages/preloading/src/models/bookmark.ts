import { belongsTo } from "@forestfuture/arbor";
import { ApplicationRecord } from "./application-record";
import { Article } from "./article";

export class Bookmark extends ApplicationRecord {
  article = belongsTo(Article, { foreignKey: "articleRef" }); // text holding an article's UUID
}
