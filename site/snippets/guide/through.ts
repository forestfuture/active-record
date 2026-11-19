import { belongsTo, hasMany, hasOne, Model } from "@forestfuture/active-record";

// #region model
export class Author extends Model.define({
  id: { type: "string", null: false, generateId: true },
  name: { type: "string", null: false },
}) {
  articles = hasMany(Article);
}

export class Article extends Model.define({
  id: { type: "string", null: false, generateId: true },
  authorId: { type: "string", null: false },
  title: { type: "string", null: false },
}) {
  author = belongsTo(Author);
  taggings = hasMany(Tagging);
  tags = hasMany(Tag, { through: "taggings" }); // each tagging's tag
}

export class Tag extends Model.define({
  id: { type: "integer", null: false },
  name: { type: "string", null: false },
}) {
  taggings = hasMany(Tagging);
  articles = hasMany(Article, { through: "taggings" }); // each tagging's article
  writers = hasMany(Author, { through: "articles", source: "author" }); // each article's author
}

export class Tagging extends Model.define({
  id: { type: "integer", null: false },
  articleId: { type: "string", null: false },
  tagId: { type: "integer", null: false },
}) {
  article = belongsTo(Article);
  tag = belongsTo(Tag);
  author = hasOne(Author, { through: "article" }); // the article's author
}
// #endregion model

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
