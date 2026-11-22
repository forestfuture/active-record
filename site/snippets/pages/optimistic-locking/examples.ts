import { StaleRecord } from "@forestfuture/active-record";
import { Article } from "./src/models/article";

export async function saving() {
  // #region stale
  const mine = await Article.findByOrThrow({ title: "Hello" });
  const theirs = await Article.findByOrThrow({ title: "Hello" });

  await theirs.update({ body: "Their edit" }); // the row's lockVersion goes from 0 to 1
  console.log(theirs.lockVersion); // 1

  mine.body = "My edit";
  await mine.save(); // throws StaleRecord: mine still has version 0
  // #endregion stale
}

export async function destroying() {
  // #region destroy
  const mine = await Article.findByOrThrow({ title: "Hello" });
  const theirs = await Article.findByOrThrow({ title: "Hello" });

  await theirs.update({ title: "Hello again" });
  await mine.destroy(); // throws StaleRecord, and the article stays
  // #endregion destroy
}

// #region form
export async function updateArticle(request: Request): Promise<Response> {
  const article = await Article.find(new URL(request.url).searchParams.get("id") ?? "");
  // lockVersion is the version the form was shown with, from a hidden field
  article.assign(Article.permit(await request.formData(), "body", "lockVersion"));
  try {
    await article.saveOrThrow();
  } catch (error) {
    if (!(error instanceof StaleRecord)) throw error;
    return new Response("Someone else changed this article. Reload it and try again.", {
      status: 409,
    });
  }
  return new Response("Saved");
}
// #endregion form

export async function retrying() {
  // #region retry
  const article = await Article.findByOrThrow({ title: "Hello" });
  await (await Article.find(article.id)).update({ title: "Hello, world" }); // another request's edit

  article.body = "A new paragraph.";
  try {
    await article.saveOrThrow();
  } catch (error) {
    if (!(error instanceof StaleRecord)) throw error;
    await article.reload(); // the row's values, and its version
    article.body = "A new paragraph.";
    await article.saveOrThrow();
  }
  // #endregion retry
  return article;
}
