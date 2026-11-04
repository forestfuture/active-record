// The benchmark's Models: an author with three associations, as an app would declare them.
import { belongsTo, hasMany, hasOne, Model } from "../../packages/active-record/src/index.ts";

export const schema = `
CREATE TABLE publishers (id TEXT PRIMARY KEY, name TEXT);
CREATE TABLE authors (id TEXT PRIMARY KEY, name TEXT NOT NULL, publisher_id TEXT, created_at TEXT);
CREATE TABLE articles (id TEXT PRIMARY KEY, author_id TEXT NOT NULL, title TEXT NOT NULL);
CREATE TABLE profiles (id TEXT PRIMARY KEY, author_id TEXT NOT NULL, bio TEXT);
`;

class Publisher extends Model.define({ id: { type: "string", null: false }, name: "string" }) {}

export class Author extends Model.define({
  id: { type: "string", null: false },
  name: { type: "string", null: false },
  publisherId: "string",
  createdAt: "datetime",
}) {
  articles = hasMany(Article, { dependent: "destroy" });
  profile = hasOne(Profile);
  publisher = belongsTo(Publisher);
}

class Article extends Model.define({
  id: { type: "string", null: false },
  authorId: { type: "string", null: false },
  title: { type: "string", null: false },
}) {}

class Profile extends Model.define({
  id: { type: "string", null: false },
  authorId: { type: "string", null: false },
  bio: "string",
}) {}
