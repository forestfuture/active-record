import { batch, column, sql } from "@forestfuture/active-record";
import { Article } from "./src/models/article";
import { Author } from "./src/models/author";
import { Comment } from "./src/models/comment";

export async function writingRows() {
  // #region statements
  const article = await Article.findByOrThrow({ title: "Getting started" });
  const deleted = await Comment.where({ articleId: article.id }).deleteAll(); // how many
  await Article.where({ id: article.id }).updateAll({ title: "Edited" });
  await Article.where({ id: article.id }).updateAll(
    sql`${column("title")} = upper(${column("title")})`,
  );
  const { rowsAffected, rows } = await Comment.insert({ articleId: article.id, body: "First!" });
  console.log(deleted, rowsAffected, rows[0]?.id); // 1 1, and the new comment's key
  // #endregion statements
  return rows[0]?.id;
}

export async function insertingMany() {
  // #region insert-all
  const article = await Article.findByOrThrow({ title: "Getting started" });
  await Comment.insertAll([
    { articleId: article.id, body: "One" },
    { articleId: article.id, body: "Two" },
  ]);
  await Author.upsert({ name: "Jane Doe", email: "jane@example.com" }, { uniqueBy: "email" }); // renames Jane
  await Author.insert({ name: "Jane", email: "jane@example.com" }, { onDuplicate: "skip" }); // writes nothing
  // #endregion insert-all
}

export async function returningRows() {
  // #region returning
  const article = await Article.findByOrThrow({ title: "Getting started" });
  const { rows } = await Comment.insertAll(
    [
      { articleId: article.id, body: "One" },
      { articleId: article.id, body: "Two" },
    ],
    { returning: ["id", "body"] },
  );
  for (const { id, body } of rows) console.log(id, body);
  await Comment.insert({ articleId: article.id, body: "Three" }, { returning: false });
  // #endregion returning
  return rows;
}

export async function batchingWrites() {
  // #region batch
  const authorId = crypto.randomUUID(); // generated in code, so the rows can point at it
  await batch((b) => [
    b.insert(Author, { id: authorId, name: "Alex", email: "alex@example.com" }),
    b.insert(Article, { authorId, title: "Hello" }),
    b.updateAll(Article.where({ title: "Getting started" }), { authorId }), // Alex takes it over
  ]);
  // #endregion batch
  return authorId;
}

export async function batchingRecords() {
  // #region records
  const article = await Article.findByOrThrow({ title: "Getting started" });
  article.title = "Getting started, again";
  const author = Author.build({ name: "Kim", email: "kim@example.com" });
  const leaving = await Author.findByOrThrow({ email: "sam@example.com" });

  const [savedArticle, savedAuthor] = await batch((b) => [
    b.save(article),
    b.save(author),
    b.destroy(leaving), // with Sam's articles and their comments
    b.deleteAll(Comment.where({ articleId: article.id })),
  ]);
  // #endregion records
  return { savedArticle, savedAuthor };
}
