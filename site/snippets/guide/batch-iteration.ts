import { Model } from "@forestfuture/active-record";

// #region model
export class Post extends Model.define({
  id: { type: "integer", null: false },
  title: { type: "string", null: false },
  publishedAt: "datetime",
}) {}
// #endregion model

export async function eachPost() {
  // #region find-each
  for await (const post of Post.where({ publishedAt: null }).findEach()) {
    console.log(post.title); // one post at a time, loaded 1,000 at a time
  }
  // #endregion find-each
}

export async function eachBatch() {
  // #region find-in-batches
  for await (const posts of Post.findInBatches({ batchSize: 2 })) {
    console.log(posts.length); // up to 2 posts at a time
  }
  // #endregion find-in-batches
}

export async function publishDrafts() {
  // #region in-batches
  const drafts = Post.where({ publishedAt: null });
  for await (const batch of drafts.inBatches({ batchSize: 500 })) {
    await batch.updateAll({ publishedAt: new Date() }); // one write per 500 drafts
  }
  // #endregion in-batches
}

export async function choosing() {
  // #region options
  const firstTwo = Post.findEach({ start: 1, finish: 2 }); // keys 1 and 2, both included
  const largestKeysFirst = Post.findInBatches({ order: "desc", batchSize: 100 });
  // #endregion options
  const titles: string[] = [];
  for await (const post of firstTwo) titles.push(post.title);
  for await (const posts of largestKeysFirst) titles.push(...posts.map((post) => post.title));
  return titles;
}
