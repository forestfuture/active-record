// The fixture's Comment, a generated Model below a class marked abstract (#232).
import { belongsTo } from "../../../packages/active-record/src/index.ts";
import { Auditable } from "./auditable.ts";
import { Post } from "./post.ts";

export class Comment extends Auditable {
  post = belongsTo(Post);
}
