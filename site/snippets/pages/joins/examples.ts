import { Article } from "./src/models/article";
import { Author } from "./src/models/author";

export async function joining() {
  // #region joins
  const commented = await Author.joins({ articles: "comments" }).distinct().toArray();
  // #endregion joins
  return commented;
}

export async function leftJoining() {
  // #region left-joins
  const everyAuthor = await Author.leftJoins("profile").toArray(); // with a profile or not
  // #endregion left-joins
  return everyAuthor;
}

export async function merging() {
  // #region merge
  const byJane = await Article.joins("author")
    .merge(Author.where({ name: "Jane" }))
    .toArray();
  const byAuthorName = await Article.joins("author")
    .merge(Author.order({ name: "asc" }))
    .toArray();
  // #endregion merge
  return { byJane, byAuthorName };
}
