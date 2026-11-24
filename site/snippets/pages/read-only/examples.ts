import { ReadonlyAttribute, ReadonlyRecord } from "@forestfuture/arbor";
import { Article } from "./src/models/article";

export async function loading() {
  // #region relation
  const articles = await Article.readonly().order({ title: "asc" }).toArray();
  console.log(articles[0]?.isReadonly()); // true

  const article = await Article.readonly().findByOrThrow({ slug: "hello" });
  article.title = "Hello, world";
  await article.save(); // throws ReadonlyRecord, and sends nothing
  // #endregion relation
}

export async function marking() {
  // #region mark
  const article = await Article.findByOrThrow({ slug: "hello" });
  article.markReadonly();

  console.log(article.isReadonly()); // true
  await article.destroy(); // throws ReadonlyRecord, and the article stays
  // #endregion mark
}

export async function catching() {
  // #region catch
  const article = await Article.findByOrThrow({ slug: "hello" });
  article.markReadonly();
  try {
    await article.touch();
  } catch (error) {
    if (!(error instanceof ReadonlyRecord)) throw error;
    console.log(error.action); // "touch"
  }
  // #endregion catch
}

export async function bulkWrites() {
  // #region bulk
  const updated = await Article.readonly().where({ slug: "hello" }).updateAll({ body: "" });
  console.log(updated); // 1: a bulk write doesn't load records, so it isn't refused
  // #endregion bulk
}

export async function creating() {
  // #region slug
  const article = await Article.create({ title: "Getting started", slug: "getting-started" });
  console.log(article.slug); // "getting-started"

  article.slug = "first-steps"; // throws ReadonlyAttribute: it's set when it's created
  // #endregion slug
}

// #region form
export async function updateArticle(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  const article = await Article.find(id);
  const form = await request.formData();
  const changes = Article.permit(form, "title", "slug");
  try {
    // A form that posts the slug back unchanged saves; one that changes it doesn't
    await article.updateOrThrow(changes);
  } catch (error) {
    if (!(error instanceof ReadonlyAttribute)) throw error;
    return new Response(`An article's ${error.attribute} can't be changed.`, { status: 422 });
  }
  return new Response("Saved");
}
// #endregion form
