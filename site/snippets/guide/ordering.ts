import { column, Model, sql } from "@forestfuture/active-record";

// #region model
export class Post extends Model.define({
  id: { type: "string", null: false, generateId: true },
  title: { type: "string", null: false },
  status: "string",
  publishedAt: "datetime",
  createdAt: { type: "datetime", null: false },
  updatedAt: { type: "datetime", null: false },
}) {}
// #endregion model

export async function ordering() {
  // #region order
  const newest = await Post.order({ publishedAt: "desc", title: "asc" }).toArray();

  Post.order({ publishedAt: { direction: "desc", nulls: "last" } }); // unpublished last, on both
  Post.order(sql`lower(${column("title")})`);
  Post.order({ title: "asc" }).reorder({ createdAt: "desc" }); // replaces the order
  Post.order({ createdAt: "desc" }).limit(20).offset(40); // page 3
  // #endregion order
  return newest;
}

export async function inOrder() {
  // #region in-order-of
  const byStatus = await Post.inOrderOf("status", ["published", "draft"]).toArray(); // only those
  const everyPost = await Post.inOrderOf("status", ["published"], { filter: false }).toArray();
  // #endregion in-order-of
  return { byStatus, everyPost };
}

// #region paginate
export async function listPosts(request: Request): Promise<Response> {
  const page = new URL(request.url).searchParams.get("page");
  const posts = await Post.order({ publishedAt: "desc" }).paginate({ page, perPage: 20 });
  return Response.json(posts); // { records, page, perPage, total, totalPages, hasNext, hasPrevious }
}
// #endregion paginate

export async function countless() {
  // #region countless
  const { records, hasNext } = await Post.order({ publishedAt: "desc" }).paginate({
    page: 2,
    perPage: 2,
    count: false,
  });
  // #endregion countless
  return { records, hasNext };
}

// #region per-page
export class ApplicationRecord extends Model {
  static override perPage = 20; // when paginate() isn't given a perPage
  static override maxPerPage = 50; // a larger perPage is capped at this
}
// #endregion per-page
