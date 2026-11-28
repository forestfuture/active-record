import { belongsTo } from "@forestfuture/arbor";
import { Account } from "./account";
import { ApplicationRecord } from "./application-record";

export class Order extends ApplicationRecord {
  account = belongsTo(Account);
}
