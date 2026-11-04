import { Model } from "@forestfuture/active-record";
import { Post } from "../getting-started/models";

// #region paginate
export async function listPosts(request: Request): Promise<Response> {
  const page = new URL(request.url).searchParams.get("page");
  const posts = await Post.order({ publishedAt: "desc" }).paginate({ page, perPage: 20 });
  return Response.json(posts); // { records, page, perPage, total, totalPages, hasNext, hasPrevious }
}
// #endregion paginate

export async function countless(): Promise<unknown> {
  // #region countless
  const posts = Post.order({ publishedAt: "desc" });
  const { records, hasNext } = await posts.paginate({ page: 2, count: false });
  // #endregion countless
  return { records, hasNext };
}

// #region per-page
export class Base extends Model {
  static override perPage = 20; // when paginate() isn't given a perPage
  static override maxPerPage = 50; // a larger perPage is capped at this
}
// #endregion per-page
