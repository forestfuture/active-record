import { Article } from "./src/models/article";
import { Author } from "./src/models/author";
import { Category } from "./src/models/category";
import { Like } from "./src/models/like";
import { Profile } from "./src/models/profile";
import { Video } from "./src/models/video";

export async function readingTheAuthor() {
  // #region belongs-to
  const article = await Article.findByOrThrow({ title: "On Nothing" });
  const author = await article.author(); // an Author, or null

  const other = await Author.findByOrThrow({ name: "Sam" });
  article.author.set(other); // written when the article is saved
  await article.save();
  // #endregion belongs-to
  return { author, article };
}

export async function readingArticles() {
  // #region has-many
  const author = await Author.findByOrThrow({ name: "Jane" });
  const articles = await author.articles().toArray(); // a Relation of the author's articles

  author.articles().build({ title: "Untitled" }); // saved with the author, with its key
  await author.save();

  await author.articles().where({ title: "Untitled" }).deleteAll(); // scoped to the author's articles
  // #endregion has-many
  return articles;
}

export async function readingTheProfile() {
  // #region has-one
  const author = await Author.findByOrThrow({ name: "Jane" });
  const profile = await author.profile(); // a Profile, or null
  if (profile === null) await author.profile.create({ bio: "Writer" }); // saved at once
  // #endregion has-one
  return profile;
}

export async function replacingTheProfile() {
  // #region has-one-replace
  const author = await Author.findByOrThrow({ name: "Jane" });
  await author.profile.set(Profile.build({ bio: "Novelist" })); // and deletes the old one, in one batch
  // #endregion has-one-replace
  return author;
}

export async function liking() {
  // #region polymorphic
  const like = await Like.firstOrThrow();
  const liked = await like.likeable(); // a Photo, a Video, or null

  const video = await Video.findByOrThrow({ title: "Launch" });
  like.likeable.set(video); // likeableType "Video", likeableId video.id
  await like.save();

  const likes = await video.likes().toArray(); // the likes whose type is "Video"
  // #endregion polymorphic
  return { liked, likes };
}

export async function caching() {
  // #region read
  const article = await Article.findByOrThrow({ title: "On Nothing" });
  const author = await article.author(); // one query
  const again = await article.author(); // none: it's cached on the article
  // #endregion read
  return { author, again };
}

export async function pointingBack() {
  // #region inverse
  const author = await Author.findByOrThrow({ name: "Jane" });
  const [article] = await author.articles().toArray();
  const sameAuthor = await article?.author(); // author itself, with no query
  // #endregion inverse
  return { author, sameAuthor };
}

export async function scoping() {
  // #region scoped
  const author = await Author.findByOrThrow({ name: "Jane" });
  const published = await author.publishedArticles().toArray(); // only the published ones
  // #endregion scoped
  return published;
}

export async function nesting() {
  // #region self-referencing
  const [top] = await Category.top().toArray();
  const children = await top?.children().toArray(); // in name order, by the scope
  const parent = await children?.[0]?.parent(); // top itself
  // #endregion self-referencing
  return { top, children, parent };
}

export async function deletingComments() {
  // #region statements
  const article = await Article.findByOrThrow({ title: "On Nothing" });
  await article.comments().deleteAll(); // one DELETE for the article's comments
  // #endregion statements
  return article;
}

export async function destroying() {
  // #region dependent
  const author = await Author.findByOrThrow({ name: "Jane" });
  await author.destroy(); // its articles, their comments, and its profile go too, in one batch
  // #endregion dependent
  return author;
}
