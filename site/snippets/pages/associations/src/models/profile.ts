import { belongsTo } from "@forestfuture/active-record";
import { ApplicationRecord } from "./application-record";
import { Author } from "./author";

export class Profile extends ApplicationRecord {
  author = belongsTo(Author);
}
