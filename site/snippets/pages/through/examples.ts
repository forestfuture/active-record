import { Article } from "./src/models/article";
import { Tag } from "./src/models/tag";
import { Tagging } from "./src/models/tagging";

export async function reading() {
  // #region read
  const tag = await Tag.findByOrThrow({ name: "essays" });
  const articles = await tag.articles().order({ title: "asc" }).toArray(); // one query

  const article = await Article.findByOrThrow({ title: "Engines" });
  const tags = await article.tags().toArray(); // the other way, through the same taggings
  // #endregion read
  return { articles, tags };
}

export async function preloading() {
  // #region preload
  const everyTag = await Tag.includes("articles").toArray(); // tags, taggings, and articles
  for (const each of everyTag) console.log(each.name, each.loaded("articles").length);
  // #endregion preload
  return everyTag;
}

export async function followingSource() {
  // #region source
  const tag = await Tag.findByOrThrow({ name: "essays" });
  const writers = await tag.writers().toArray(); // each author once
  // #endregion source
  return writers;
}

export async function throughBelongsTo() {
  // #region has-one
  const tagging = await Tagging.firstOrThrow();
  const author = await tagging.author();
  // #endregion has-one
  return author;
}

export async function writing() {
  // #region write
  const tag = await Tag.findByOrThrow({ name: "essays" });
  const article = await Article.findByOrThrow({ title: "Engines" });

  await tag.articles().push(article); // saves a tagging that links them
  const draft = await tag.articles().create({ authorId: article.authorId, title: "Draft" });

  await tag.articles().delete(article); // deletes the tagging; the article stays
  // #endregion write
  return draft;
}
