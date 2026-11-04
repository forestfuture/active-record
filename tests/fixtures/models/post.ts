// The fixture's Post, a generated Model with an override, associations, a method and a scope
// (#232).
import { belongsTo, hasMany } from "../../../packages/active-record/src/index.ts";
import { Comment } from "./comment.ts";
import { DbRecord } from "./db-record.ts";
import { User } from "./user.ts";

export class Post extends DbRecord {
  static override attributes = { published: "boolean" } as const;

  user = belongsTo(User);
  comments = hasMany(Comment);

  static titled = this.scope((q, title: string) => q.where({ title }));

  get shout(): string {
    return this.title.toUpperCase();
  }
}
