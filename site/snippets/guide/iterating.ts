import { Post, User } from "../getting-started/models";

export async function examples(start: string, finish: string): Promise<string[]> {
  const seen: string[] = [];

  // #region find-each
  for await (const user of User.where({ isActive: true }).findEach()) {
    seen.push(user.email); // one user at a time, loaded 1,000 at a time
  }
  // #endregion find-each

  // #region find-in-batches
  for await (const users of User.findInBatches({ batchSize: 500 })) {
    const emails = users.map((user) => user.email); // up to 500 users at a time
    seen.push(...emails);
  }
  // #endregion find-in-batches

  // #region in-batches
  const drafts = Post.where({ publishedAt: null });
  for await (const batch of drafts.inBatches({ batchSize: 500 })) {
    await batch.updateAll({ title: "Untitled" });
  }
  // #endregion in-batches

  // #region options
  const range = User.findEach({ start, finish }); // keys from start to finish, both included
  const newestKeysFirst = Post.findInBatches({ order: "desc" }); // from the largest key down
  // #endregion options
  for await (const user of range) seen.push(user.email);
  for await (const posts of newestKeysFirst) seen.push(...posts.map((post) => post.title));

  return seen;
}
