import { belongsTo, hasMany, Model } from "@forestfuture/active-record";

// #region cascade
export class Blog extends Model.define({
  id: { type: "integer", null: false },
  updatedAt: "datetime",
}) {}

export class Article extends Model.define({
  id: { type: "integer", null: false },
  blogId: "integer",
  title: { type: "string", null: false },
  updatedAt: "datetime",
  lastCommentedAt: "datetime",
}) {
  blog = belongsTo(Blog, { touch: true }); // touching an article touches its blog
  comments = hasMany(Comment);
}
// #endregion cascade

// #region declare
export class Comment extends Model.define({
  id: { type: "integer", null: false },
  articleId: "integer",
  body: { type: "string", null: false },
  updatedAt: "datetime",
}) {
  article = belongsTo(Article, { touch: true });
}
// #endregion declare

// #region named
export class Reply extends Model.define({
  id: { type: "integer", null: false },
  articleId: "integer",
  body: { type: "string", null: false },
}) {
  static table = "comments";
  article = belongsTo(Article, { touch: "lastCommentedAt" }); // and updatedAt
}
// #endregion named

export async function examples(id: number) {
  // #region touching
  const article = await Article.find(id);
  const comment = await article.comments().create({ body: "First!" }); // sets article.updatedAt
  await comment.update({ body: "Edited" }); // sets it again
  await comment.touch(); // and again
  // #endregion touching

  // #region preload
  const comments = await Comment.includes({ article: "blog" }).toArray();
  for (const each of comments) await each.touch(); // no query to load an article or blog
  // #endregion preload
  return { article, comment };
}
