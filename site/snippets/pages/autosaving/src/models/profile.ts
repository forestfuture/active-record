import { belongsTo } from "@forestfuture/arbor";
import { ApplicationRecord } from "./application-record";
import { Author } from "./author";

export class Profile extends ApplicationRecord {
  author = belongsTo(Author);
}
