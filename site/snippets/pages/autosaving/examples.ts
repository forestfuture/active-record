import { Article } from "./src/models/article";
import { Author } from "./src/models/author";

export async function creatingThrough() {
  // #region create-through
  const article = await Article.findByOrThrow({ title: "On Nothing" });
  const comment = await article.comments().create({ body: "Lovely." }); // articleId filled in
  // #endregion create-through
  return comment;
}

export async function savingAGraph() {
  // #region autosave
  const author = Author.build({ name: "Sam" });
  author.articles().build({ title: "Getting started" });
  author.articles().build({ title: "Going further" });
  author.profile.build({ bio: "Writer" });
  await author.saveOrThrow(); // the author, both articles, and the profile, in one batch
  // #endregion autosave
  return author;
}

export async function savingChanges() {
  // #region save-changed
  const author = await Author.findByOrThrow({ name: "Jane" });
  const articles = await author.articles().toArray();

  for (const article of articles) article.title = article.title.toUpperCase();
  await author.saveOrThrow(); // every article that changed, in one batch
  // #endregion save-changed
  return articles;
}

export async function removingDrafts() {
  // #region mark-for-destruction
  const author = await Author.findByOrThrow({ name: "Jane" });
  const articles = await author.articles().toArray();

  for (const article of articles) {
    if (article.title.startsWith("Draft")) article.markForDestruction();
  }
  await author.saveOrThrow(); // destroys the drafts, with their comments
  // #endregion mark-for-destruction
  return author;
}
