import { belongsTo, hasMany } from "@forestfuture/active-record";
import { ApplicationRecord } from "./application-record";
import { Author } from "./author";
import { Comment } from "./comment";

export class Article extends ApplicationRecord {
  author = belongsTo(Author);
  comments = hasMany(Comment, { dependent: "destroy" }); // destroyed with their article
}
