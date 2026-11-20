import { Author } from "./src/models/author";
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
