import { RecordInvalid } from "@forestfuture/active-record";
import { Article } from "./src/models/article";
import { Label } from "./src/models/label";
import { Post } from "./src/models/post";
import { User } from "./src/models/user";

export async function saving() {
  // #region save
  const user = User.build({ email: "jane@example.com" });
  if (await user.save()) {
    // saved: user.isPersisted() is true
  } else {
    console.log(user.errors.fullMessages()); // ["Email has already been taken"]
  }

  const created = await User.create({ email: "sam@example.com" }); // saved, or not
  await created.update({ isActive: false }); // true or false
  // #endregion save
  return { user, created };
}

// #region or-throw
export async function signUp(request: Request): Promise<Response> {
  try {
    const { email } = await request.json<{ email: string }>();
    const user = await User.createOrThrow({ email });
    return Response.json(user, { status: 201 });
  } catch (error) {
    if (error instanceof RecordInvalid) {
      return Response.json({ errors: error.record.errors.fullMessages() }, { status: 422 });
    }
    throw error; // anything else is a real failure
  }
}
// #endregion or-throw

export async function changingInMemory() {
  // #region in-memory
  const article = await Article.findByOrThrow({ title: "Hello" });
  article.increment("viewCount"); // viewCount + 1, not saved yet
  article.toggle("isPinned");
  await article.save();
  // #endregion in-memory
  return article;
}

export async function writingColumns() {
  // #region columns
  const article = await Article.findByOrThrow({ title: "Hello" });
  await article.incrementColumn("viewCount"); // adds 1 in the row, now
  await article.toggleColumn("isPinned");
  await article.updateColumns({ title: "Renamed" }); // no validations, callbacks, or updatedAt
  // #endregion columns
  return article;
}

export async function touching() {
  // #region touching
  const article = await Article.findByOrThrow({ title: "Hello" });
  await article.touch(); // sets updatedAt to now
  await article.touch("viewedAt"); // sets viewedAt and updatedAt
  await article.touch({ time: new Date("2026-01-01T00:00:00Z") });
  await Article.where({ isPinned: true }).touchAll(); // every pinned article, in one statement
  // #endregion touching
  return article.reload();
}

export async function counting() {
  // #region counters
  const { id } = await Article.findByOrThrow({ title: "Hello" });
  await Article.updateCounters(id, { viewCount: 1 });
  await Article.where({ isPinned: true }).updateCounters({ viewCount: 10 });
  await Article.incrementCounter("viewCount", [id], { by: 5, touch: true }); // sets updatedAt too
  // #endregion counters
  return Article.find(id);
}

export async function countingInScope() {
  // #region scoped-counter
  const { id } = await Article.findByOrThrow({ title: "Hello" });
  await Article.where({ id }).updateCounters({ viewCount: 1 }); // keeps the default scope
  // #endregion scoped-counter
  return Article.find(id);
}

export async function creatingArticles() {
  // #region previously-new
  const article = await Article.create({ title: "Fresh" }); // logs "New article: Fresh"
  await article.update({ title: "Fresher" }); // logs nothing
  // #endregion previously-new
  return article;
}

export async function findingOrCreating() {
  // #region find-or-create
  const travel = await Label.findOrCreateBy({ name: "travel" }); // found, or created
  const food = await Label.findOrInitializeBy({ name: "food" }); // found, or built and not saved
  // #endregion find-or-create

  // #region create-with
  const music = await Label.createWith({ color: "blue" }).findOrCreateBy({ name: "music" }); // blue
  // #endregion create-with

  // #region init
  const art = await Label.findOrCreateBy({ name: "art" }, (label) => {
    label.color = "green"; // set only when it's created
  });
  // #endregion init

  // #region create-or-find
  const news = await Label.createOrFindBy({ name: "news" }); // created, or found
  // #endregion create-or-find
  return [travel, food, music, art, news];
}

export async function destroying() {
  // #region destroy
  const user = await User.findByOrThrow({ email: "jane@example.com" });
  const destroyed = await user.destroy(); // the record, or false if a callback aborted
  if (destroyed) console.log(destroyed.isDestroyed()); // true: readable, but can't be saved
  // #endregion destroy
  return user;
}

export async function destroyingMany() {
  // #region destroy-many
  const drafts = await Post.where({ publishedAt: null }).destroyAll(); // the destroyed posts
  const user = await User.findByOrThrow({ email: "jane@example.com" });
  await Post.destroyBy({ userId: user.id }); // where(…).destroyAll()
  // #endregion destroy-many
  return drafts;
}

export async function destroyingInBatches() {
  // #region destroy-in-batches
  const unpublished = Post.where({ publishedAt: null });
  for await (const batch of unpublished.inBatches({ batchSize: 100 })) {
    await batch.destroyAll(); // one write per batch
  }
  // #endregion destroy-in-batches
}

export async function reloading() {
  // #region reload
  const user = await User.findByOrThrow({ email: "jane@example.com" });
  user.email = "changed@example.com";
  await user.reload(); // back to what the database holds
  // #endregion reload
  return user;
}
