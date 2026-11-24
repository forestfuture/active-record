import { belongsTo } from "@forestfuture/arbor";
import { ApplicationRecord } from "./application-record";
import { Article } from "./article";

export class Reply extends ApplicationRecord {
  static override table = "comments";

  article = belongsTo(Article, { touch: "lastCommentedAt" }); // and updatedAt
}
