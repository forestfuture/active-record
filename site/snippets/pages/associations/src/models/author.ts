import { hasMany, hasOne } from "@forestfuture/active-record";
import { ApplicationRecord } from "./application-record";
import { Article } from "./article";
import { Profile } from "./profile";

export class Author extends ApplicationRecord {
  articles = hasMany(Article, { dependent: "destroy" }); // Article's authorId
  profile = hasOne(Profile, { dependent: "delete" }); // Profile's authorId

  // A scope turns finding the inverse off, so name it:
  publishedArticles = hasMany(Article, {
    scope: (q) => q.where({ published: true }),
    inverseOf: "author",
  });
}
