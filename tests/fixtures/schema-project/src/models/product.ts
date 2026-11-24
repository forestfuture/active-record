import { belongsTo } from "@forestfuture/arbor";
import { ApplicationRecord } from "./application-record";
import { User } from "./user";

export class Product extends ApplicationRecord {
  user = belongsTo(User);
}
