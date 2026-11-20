import { belongsTo } from "@forestfuture/active-record";
import { ApplicationRecord } from "./application-record";
import { Article } from "./article";

export class Comment extends ApplicationRecord {
  article = belongsTo(Article, { counterCache: true }); // keeps Article's commentsCount
}
