import { hasMany } from "@forestfuture/active-record";
import { ApplicationRecord } from "./application-record";
import { Post } from "./post";

export class User extends ApplicationRecord {
  posts = hasMany(Post, { dependent: "destroy" }); // posts.user_id points here

  static active = this.scope((q) => q.where({ isActive: true }));

  static {
    this.validates("email", { presence: true, uniqueness: true });
    this.beforeSave((user) => {
      user.email = user.email.toLowerCase();
    });
  }
}
