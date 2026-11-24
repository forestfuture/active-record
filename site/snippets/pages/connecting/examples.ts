import { batch, withDatabase } from "@forestfuture/active-record";
import { connect } from "@forestfuture/active-record/d1";
import { app } from "./src/app";
import { Post } from "./src/models/post";
import { User } from "./src/models/user";

// #region request
// src/worker.ts: the app's Worker, with a database for each request.
export const worker = {
  fetch(request, env) {
    const db = connect(env.DB, { onQuery: ({ sql }) => console.log(sql) });
    return withDatabase(db, () => app.fetch(request)); // every query inside uses db
  },
} satisfies ExportedHandler<Env>;
// #endregion request

// #region request-cache
export async function findTwice(env: Env) {
  return withDatabase(connect(env.DB), async () => {
    const user = await User.findByOrThrow({ email: "jane@example.com" }); // sent
    const again = await User.findByOrThrow({ email: "jane@example.com" }); // answered from memory
    return [user, again] as const;
  });
}
// #endregion request-cache

// #region uncached
export function uncachedDatabase(env: Env) {
  return connect(env.DB, { cache: { request: false } }); // every read is sent
}
// #endregion uncached

// #region clear-request-cache
export async function renamePost(env: Env, id: string) {
  const db = connect(env.DB);
  return withDatabase(db, async () => {
    const post = await Post.find(id);
    await env.DB.prepare("UPDATE posts SET title = ? WHERE id = ?").bind("Hello again", id).run();
    db.clearRequestCache(); // the UPDATE didn't go through Active Record
    return Post.find(post.id); // sent, so it reads "Hello again"
  });
}
// #endregion clear-request-cache

// #region explicit
export async function findJane(env: Env) {
  const db = connect(env.DB);
  return db.model(User).findByOrThrow({ email: "jane@example.com" }); // ignores withDatabase
}
// #endregion explicit

// #region models
export async function listPosts(env: Env) {
  const models = connect(env.DB).models({ User, Post });
  return models.Post.order({ title: "asc" }).pluck("title");
}
// #endregion models

export async function signingUp() {
  // #region batch
  const user = User.build({ email: "sam@example.com" });
  const post = user.posts().build({ title: "Hello" }); // points at the user, saved or not
  await batch((b) => [b.save(user), b.save(post)]); // atomic: both written, or neither
  // #endregion batch
}
