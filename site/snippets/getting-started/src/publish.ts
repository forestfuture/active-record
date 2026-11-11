import { batch } from "@forestfuture/active-record";
import { Post } from "./models/post";
import type { User } from "./models/user";

export async function publishDraftsAndRemove(user: User): Promise<void> {
  // #region batch
  await batch((b) => [
    b.updateAll(Post.where({ publishedAt: null }), { publishedAt: new Date() }),
    b.destroy(user), // and the user's posts, since posts are dependent: "destroy"
  ]);
  // #endregion batch
}
