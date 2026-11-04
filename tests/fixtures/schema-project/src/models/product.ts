import { belongsTo } from "@forestfuture/active-record";
import { ApplicationRecord } from "./application-record";
import { User } from "./user";

export class Product extends ApplicationRecord {
  user = belongsTo(User);
}
