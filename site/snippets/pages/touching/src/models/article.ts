import { belongsTo, hasMany } from "@forestfuture/active-record";
import { ApplicationRecord } from "./application-record";
import { Blog } from "./blog";
import { Comment } from "./comment";

export class Article extends ApplicationRecord {
  blog = belongsTo(Blog, { touch: true }); // touching an article touches its blog
  comments = hasMany(Comment);
}
