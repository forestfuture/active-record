import { belongsTo } from "@forestfuture/active-record";
import { ApplicationRecord } from "./application-record";
import { Forum } from "./forum";

export class Reply extends ApplicationRecord {
  forum = belongsTo(Forum, { counterCache: "replyCount" });
}
