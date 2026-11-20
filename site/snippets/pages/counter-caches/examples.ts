import { Article } from "./src/models/article";

export async function counting() {
  // #region counting
  const article = await Article.findByOrThrow({ title: "Hello" });
  const comment = await article.comments().create({ body: "First!" }); // commentsCount + 1
  await comment.destroy(); // commentsCount - 1
  // #endregion counting
  return article;
}

export async function reading() {
  // #region size
  const article = await Article.findByOrThrow({ title: "Hello" });
  const count = await article.comments().size(); // reads commentsCount, with no query
  // #endregion size
  return count;
}

export async function resetting() {
  // #region reset
  const article = await Article.findByOrThrow({ title: "Hello" });
  await Article.resetCounters(article.id, "comments", { touch: true }); // counts the rows
  // #endregion reset
  return article.reload();
}
