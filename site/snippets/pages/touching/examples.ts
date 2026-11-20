import { Article } from "./src/models/article";
import { Comment } from "./src/models/comment";
import { Reply } from "./src/models/reply";
import { User } from "./src/models/user";

export async function touching() {
  // #region touching
  const article = await Article.findByOrThrow({ title: "Hello" });
  const comment = await article.comments().create({ body: "First!" }); // sets article.updatedAt
  await comment.update({ body: "Edited" }); // sets it again
  await comment.touch(); // and again
  // #endregion touching
  return article;
}

export async function replying() {
  // #region named
  const article = await Article.findByOrThrow({ title: "Hello" });
  await Reply.create({ articleId: article.id, body: "Agreed" }); // sets updatedAt and lastCommentedAt
  // #endregion named
  return article.reload();
}

export async function preloading() {
  // #region preload
  const comments = await Comment.includes({ article: "blog" }).toArray();
  for (const comment of comments) await comment.touch(); // no query to load an article or blog
  // #endregion preload
  return comments;
}

export async function importing() {
  // #region no-touching
  const article = await Article.findByOrThrow({ title: "Hello" });
  await Article.noTouching(async () => {
    for (const body of ["One", "Two"]) {
      await Comment.create({ articleId: article.id, body }); // doesn't touch the article
    }
  });
  await article.touch(); // touch it once, after the import
  // #endregion no-touching
  return article;
}

export async function renaming() {
  // #region has-one
  const user = await User.findByOrThrow({ name: "Sam" });
  await user.update({ name: "Sam Smith" }); // sets the user's profile's updatedAt
  await user.touch(); // and again
  // #endregion has-one
  return user;
}
