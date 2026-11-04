import { belongsTo } from "@forestfuture/active-record";
import { ApplicationRecord } from "./application-record";
import { User } from "./user";

export class Post extends ApplicationRecord {
  user = belongsTo(User);
}
