import { belongsTo } from "@forestfuture/active-record";
import { ApplicationRecord } from "./application-record";
import { Article } from "./article";

export class ImportedComment extends ApplicationRecord {
  static override table = "comments";

  // Writes keep commentsCount, but nothing reads it until active: false goes.
  article = belongsTo(Article, { counterCache: { attribute: "commentsCount", active: false } });
}
