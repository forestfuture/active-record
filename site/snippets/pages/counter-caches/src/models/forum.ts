import { hasMany } from "@forestfuture/active-record";
import { ApplicationRecord } from "./application-record";
import { Reply } from "./reply";

export class Forum extends ApplicationRecord {
  replies = hasMany(Reply, { counterCache: "replyCount" }); // not repliesCount
}
