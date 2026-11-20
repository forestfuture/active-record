// The Models the guide's batches examples use (site/snippets/guide/batches.ts).
import { belongsTo, hasMany, hasOne, Model } from "@forestfuture/active-record";

export class Author extends Model.define({
  id: { type: "string", null: false, generateId: true },
  name: { type: "string", null: false },
}) {
  articles = hasMany(Article, { dependent: "destroy", autosave: true }); // Article's authorId
  profile = hasOne(Profile, { dependent: "delete" }); // Profile's authorId
}

export class Article extends Model.define({
  id: { type: "string", null: false, generateId: true },
  authorId: { type: "string", null: false },
  title: { type: "string", null: false },
}) {
  author = belongsTo(Author); // its own authorId
  comments = hasMany(Comment, { dependent: "deleteAll" }); // Comment's articleId
}

export class Profile extends Model.define({
  id: { type: "integer", null: false },
  authorId: { type: "string", null: false },
  bio: "string",
}) {}

export class Comment extends Model.define({
  id: { type: "integer", null: false },
  articleId: { type: "string", null: false },
  body: { type: "string", null: false },
}) {}
