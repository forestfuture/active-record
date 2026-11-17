import { Article, Author } from "./associations";

export async function joinsExample() {
  // #region joins
  const commented = Author.joins({ articles: "comments" }).distinct();
  const authors = await commented.toArray(); // each author with a commented article, once
  // #endregion joins

  // #region left-joins
  const withProfiles = Author.leftJoins("profile"); // every author, with a profile or not
  const everyAuthor = await withProfiles.toArray();
  // #endregion left-joins

  // #region merge
  const byMary = Article.joins("author").merge(Author.where({ name: "Mary" }));
  const titles = await byMary.pluck("title");
  const byAuthorName = Article.joins("author").merge(Author.order({ name: "asc" }));
  // #endregion merge

  return { authors, everyAuthor, titles, inOrder: await byAuthorName.pluck("title") };
}
