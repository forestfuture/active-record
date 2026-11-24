import { belongsTo } from "@forestfuture/arbor";
import { ApplicationRecord } from "./application-record";
import { User } from "./user";

export class Post extends ApplicationRecord {
  user = belongsTo(User);
}
