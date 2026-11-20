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

  const ada = await Author.findByOrThrow({ name: "Ada" });
  article.author.set(ada); // written when the article is saved
  await article.save();
  // #endregion belongs-to
  return { author, article };
}

export async function readingArticles() {
  // #region has-many
  const mary = await Author.findByOrThrow({ name: "Mary" });
  const articles = await mary.articles().toArray(); // a Relation of her articles

  mary.articles().build({ title: "Untitled" }); // saved with her, with her key
  await mary.save();

  await mary.articles().where({ title: "Untitled" }).deleteAll(); // scoped to her articles
  // #endregion has-many
  return articles;
}

export async function readingTheProfile() {
  // #region has-one
  const mary = await Author.findByOrThrow({ name: "Mary" });
  const profile = await mary.profile(); // a Profile, or null
  if (profile === null) await mary.profile.create({ bio: "Writer" }); // saved at once
  // #endregion has-one
  return profile;
}

export async function replacingTheProfile() {
  // #region has-one-replace
  const mary = await Author.findByOrThrow({ name: "Mary" });
  await mary.profile.set(Profile.build({ bio: "Novelist" })); // and deletes her old one, in one batch
  // #endregion has-one-replace
  return mary;
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
  const mary = await Author.findByOrThrow({ name: "Mary" });
  const [article] = await mary.articles().toArray();
  const author = await article?.author(); // mary herself, with no query
  // #endregion inverse
  return { mary, author };
}

export async function scoping() {
  // #region scoped
  const mary = await Author.findByOrThrow({ name: "Mary" });
  const published = await mary.publishedArticles().toArray(); // only her published ones
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
  const mary = await Author.findByOrThrow({ name: "Mary" });
  await mary.destroy(); // her articles, their comments, and her profile go too, in one batch
  // #endregion dependent
  return mary;
}
