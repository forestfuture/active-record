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
  const ada = Author.build({ name: "Ada" });
  ada.articles().build({ title: "Notes on the Analytical Engine" });
  ada.articles().build({ title: "Sketch of the Engine" });
  ada.profile.build({ bio: "Mathematician" });
  await ada.saveOrThrow(); // the author, both articles, and the profile, in one batch
  // #endregion autosave
  return ada;
}

export async function savingChanges() {
  // #region save-changed
  const mary = await Author.findByOrThrow({ name: "Mary" });
  const articles = await mary.articles().toArray();

  for (const article of articles) article.title = article.title.toUpperCase();
  await mary.saveOrThrow(); // every article that changed, in one batch
  // #endregion save-changed
  return articles;
}

export async function removingDrafts() {
  // #region mark-for-destruction
  const mary = await Author.findByOrThrow({ name: "Mary" });
  const articles = await mary.articles().toArray();

  for (const article of articles) {
    if (article.title.startsWith("Draft")) article.markForDestruction();
  }
  await mary.saveOrThrow(); // destroys the drafts, with their comments
  // #endregion mark-for-destruction
  return mary;
}
