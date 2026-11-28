import { Author } from "./src/models/author";
import { Bookmark } from "./src/models/bookmark";
import { Like } from "./src/models/like";

export async function preloading() {
  // #region preload
  const authors = await Author.includes("profile", { articles: "comments" }).toArray();

  for (const author of authors) {
    const articles = await author.articles().toArray(); // no query: already loaded
    console.log(author.name, articles.length, author.loaded("profile")?.bio);
  }
  // #endregion preload
  return authors;
}

export async function preloadingPolymorphic() {
  // #region polymorphic
  const likes = await Like.includes("likeable").toArray(); // the likes, photos, and videos

  for (const like of likes) {
    console.log(like.loaded("likeable")?.title); // no query: already loaded
  }
  // #endregion polymorphic
  return likes;
}

export async function preloadingAcrossKeyTypes() {
  // #region across-key-types
  const bookmarks = await Bookmark.includes("article").toArray(); // once the bookmarks are loaded

  for (const bookmark of bookmarks) {
    console.log(bookmark.loaded("article")?.title); // no query: already loaded
  }
  // #endregion across-key-types
  return bookmarks;
}
