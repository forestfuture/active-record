import { belongsTo, hasMany } from "@forestfuture/active-record";
import { ApplicationRecord } from "./application-record";

export class User extends ApplicationRecord {
  posts = hasMany(Post, { dependent: "destroy" }); // foreign key inferred: Post's userId

  static active = this.scope((q) => q.where({ isActive: true }));

  static {
    this.validates("email", { presence: true, uniqueness: true });
  }
}

export class Post extends ApplicationRecord {
  user = belongsTo(User); // foreign key inferred: userId
}
