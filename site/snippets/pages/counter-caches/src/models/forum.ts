import { hasMany } from "@forestfuture/arbor";
import { ApplicationRecord } from "./application-record";
import { Reply } from "./reply";

export class Forum extends ApplicationRecord {
  replies = hasMany(Reply, { counterCache: "replyCount" }); // not repliesCount
}
