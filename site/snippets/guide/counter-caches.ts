import { belongsTo, hasMany, Model } from "@forestfuture/active-record";

// #region declare
export class Article extends Model.define({
  id: { type: "integer", null: false },
  title: { type: "string", null: false },
  commentsCount: { type: "integer", null: false },
  updatedAt: "datetime",
}) {
  comments = hasMany(Comment);
}

export class Comment extends Model.define({
  id: { type: "integer", null: false },
  articleId: "integer",
  body: { type: "string", null: false },
}) {
  article = belongsTo(Article, { counterCache: true }); // keeps Article's commentsCount
}
// #endregion declare

// #region backfill
export class ImportedComment extends Model.define({
  id: { type: "integer", null: false },
  articleId: "integer",
}) {
  static table = "comments";
  // Writes keep commentsCount, but nothing reads it until active: false goes.
  article = belongsTo(Article, { counterCache: { attribute: "commentsCount", active: false } });
}
// #endregion backfill

export async function examples(id: number) {
  // #region counting
  const article = await Article.find(id);
  const comment = await article.comments().create({ body: "First!" }); // commentsCount + 1
  await comment.destroy(); // commentsCount - 1
  // #endregion counting

  // #region size
  await article.comments().create({ body: "Hello" });
  const count = await article.comments().size(); // reads commentsCount, no query
  // #endregion size

  // #region reset
  await Article.resetCounters(id, "comments", { touch: true });
  // #endregion reset
  return { article, count };
}
