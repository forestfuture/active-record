import { belongsTo } from "@forestfuture/arbor";
import { ApplicationRecord } from "./application-record";
import { Article } from "./article";

export class Comment extends ApplicationRecord {
  article = belongsTo(Article);
}
