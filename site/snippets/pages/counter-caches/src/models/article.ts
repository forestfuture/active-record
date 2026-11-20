import { hasMany } from "@forestfuture/active-record";
import { ApplicationRecord } from "./application-record";
import { Comment } from "./comment";

export class Article extends ApplicationRecord {
  comments = hasMany(Comment); // size() reads commentsCount
}
