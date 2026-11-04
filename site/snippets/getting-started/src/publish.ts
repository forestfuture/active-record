import { batch } from "@forestfuture/active-record";
import { Post } from "./models/post";
import type { User } from "./models/user";

export async function publishDraftsAndRemove(user: User): Promise<void> {
  // #region batch
  await batch([
    Post.where({ publishedAt: null }).toUpdateAll({ publishedAt: new Date() }),
    user.toDestroy(), // and the user's posts, since posts are dependent: "destroy"
  ]);
  // #endregion batch
}
