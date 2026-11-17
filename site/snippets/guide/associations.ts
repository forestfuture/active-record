import { belongsTo, hasMany, hasOne, Model, type HasMany } from "@forestfuture/active-record";

// #region declare
export class Author extends Model.define({
  id: { type: "string", null: false, generateId: true },
  name: { type: "string", null: false },
}) {
  articles = hasMany(Article, { dependent: "destroy", autosave: true }); // Article's authorId
  profile = hasOne(Profile, { dependent: "delete" }); // Profile's authorId
}

export class Article extends Model.define({
  id: { type: "string", null: false, generateId: true },
  authorId: { type: "string", null: false },
  title: { type: "string", null: false },
}) {
  author = belongsTo(Author); // its own authorId
  comments = hasMany(Comment, { dependent: "deleteAll" }); // Comment's articleId
}

export class Profile extends Model.define({
  id: { type: "integer", null: false },
  authorId: { type: "string", null: false },
  bio: "string",
}) {}

export class Comment extends Model.define({
  id: { type: "integer", null: false },
  articleId: { type: "string", null: false },
  body: { type: "string", null: false },
}) {}
// #endregion declare

// #region scoped
export class Blog extends Model.define({ id: { type: "integer", null: false } }) {
  // A scope for the association, as Rails' `has_many :posts, -> { … }`.
  recentPosts = hasMany(BlogPost, {
    scope: (q) => q.order({ createdAt: "desc" }).where({ draft: false }),
  });
}
// #endregion scoped

export class BlogPost extends Model.define({
  id: { type: "integer", null: false },
  blogId: { type: "integer", null: false },
  draft: { type: "boolean", null: false },
  createdAt: "datetime",
}) {}

export async function readExample(articleId: string) {
  // #region read
  const article = await Article.find(articleId);
  const author = await article.author(); // an Author, or null
  const profile = await author?.profile(); // a Profile, or null
  const latest = await author?.articles().first();
  // #endregion read
  return { author, profile, latest };
}

export async function autosaveExample() {
  // #region autosave
  const ada = Author.build({ name: "Ada" });
  ada.articles().build({ title: "Notes on the Analytical Engine" });
  ada.articles().build({ title: "Sketch of the Engine" });
  ada.profile.build({ bio: "Mathematician" });
  await ada.saveOrThrow(); // the author, both articles and the profile, in one batch
  // #endregion autosave
  return ada;
}

export async function saveChangedExample(authorId: string) {
  // #region save-changed
  const author = await Author.find(authorId);
  const articles = await author.articles().toArray();

  for (const article of articles) article.title = article.title.toUpperCase();
  await author.saveOrThrow(); // every article that changed, in one batch
  // #endregion save-changed
  return articles;
}

export async function markForDestructionExample(authorId: string) {
  // #region mark-for-destruction
  const author = await Author.find(authorId);
  const articles = await author.articles().toArray();

  for (const article of articles) {
    if (article.title.startsWith("Draft")) article.markForDestruction();
  }
  await author.saveOrThrow(); // destroys the drafts, with their comments
  // #endregion mark-for-destruction
  return articles;
}

export async function createThroughExample(articleId: string) {
  const article = await Article.find(articleId);
  // #region create-through
  const comment = await article.comments().create({ body: "Lovely." }); // articleId filled in
  // #endregion create-through
  return comment;
}

export async function writersExample(ada: Author) {
  // #region writers
  const draft = Article.build({ title: "Untitled" });
  draft.author.set(ada); // sets draft.authorId, and ada is its loaded author
  await draft.save();

  const grace = Author.build({ name: "Grace" });
  const another = Article.build({ title: "COBOL" });
  another.author.set(grace); // a new author: saved first, when the article is
  await another.save();
  // #endregion writers
  return { draft, another, grace };
}

export async function preloadExample() {
  // #region preload
  const authors = await Author.includes("profile", { articles: "comments" }) // 4 queries in 3 round trips, however many authors
    .toArray();

  for (const each of authors) {
    const articles = await each.articles().toArray(); // no query: already loaded
    console.log(each.name, articles.length, each.loaded("profile")?.bio);
  }
  // #endregion preload
  return authors;
}

export async function statementsExample(article: Article) {
  // #region statements
  await article.comments().deleteAll(); // one DELETE for the article's comments
  // #endregion statements
}

// #region through
export class Tag extends Model.define({
  id: { type: "integer", null: false },
  name: { type: "string", null: false },
}) {
  taggings = hasMany(Tagging);
  articles = hasMany(Article, { through: "taggings" }); // each tagging's article
}

export class Tagging extends Model.define({
  id: { type: "integer", null: false },
  articleId: { type: "string", null: false },
  tagId: { type: "integer", null: false },
}) {
  article = belongsTo(Article);
  tag = belongsTo(Tag);
}
// #endregion through

export class TagWithAuthors extends Model.define({
  id: { type: "integer", null: false },
  name: { type: "string", null: false },
}) {
  static table = "tags";

  taggings = hasMany(Tagging, { foreignKey: "tagId" });
  articles = hasMany(Article, { through: "taggings" });
  // #region through-source
  writers = hasMany(Author, { through: "articles", source: "author" }); // each article's author
  // #endregion through-source
}

export class TaggingWithAuthor extends Model.define({
  id: { type: "integer", null: false },
  articleId: { type: "string", null: false },
}) {
  static table = "taggings";

  article = belongsTo(Article);
  // #region through-has-one
  author = hasOne(Author, { through: "article" }); // the article's author
  // #endregion through-has-one
}

export async function throughExample(tagId: number) {
  // #region through-read
  const tag = await Tag.find(tagId);
  const articles = await tag.articles().order({ title: "asc" }).toArray(); // one query

  const tags = await Tag.includes("articles").toArray(); // tags, taggings, and articles: one round trip
  for (const each of tags) console.log(each.name, each.loaded("articles").length);
  // #endregion through-read
  return articles;
}

// #region self-referencing
export class Category extends Model.define({
  id: { type: "integer", null: false },
  parentId: "integer",
}) {
  static top = this.scope((q) => q.where({ parentId: null }));

  // Written out: TypeScript can't infer a field whose scope uses its own Model's scopes.
  children: HasMany<typeof Category> = hasMany(Category, {
    foreignKey: "parentId",
    scope: (q) => q.top(),
  });
  parent = belongsTo(Category, { foreignKey: "parentId", optional: true });
}
// #endregion self-referencing

export async function belongsToExample(articleId: string, editor: Author) {
  // #region belongs-to
  const article = await Article.find(articleId);
  const author = await article.author(); // an Author, or null

  article.author.set(editor); // points it at another author: written when the article is saved
  await article.save();
  // #endregion belongs-to
  return author;
}

export async function hasManyExample(authorId: string) {
  // #region has-many
  const author = await Author.find(authorId);
  const articles = await author.articles().toArray(); // a Relation of the author's articles

  author.articles().build({ title: "Untitled" }); // saved with the author, with its key
  await author.save();

  await author.articles().where({ title: "Untitled" }).deleteAll(); // bulk writes, scoped to the author
  // #endregion has-many
  return articles;
}

export async function hasOneExample(authorId: string) {
  // #region has-one
  const author = await Author.find(authorId);
  const profile = await author.profile(); // a Profile, or null

  if (profile === null) await author.profile.create({ bio: "Writer" }); // saved at once
  // #endregion has-one
  return profile;
}

export async function replaceProfileExample(authorId: string) {
  // #region has-one-replace
  const author = await Author.find(authorId);
  const profile = Profile.build({ bio: "Novelist" });

  await author.profile.set(profile); // saves it, and deletes the old profile in the same batch
  // #endregion has-one-replace
  return profile;
}
