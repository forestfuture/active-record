import { Model } from "@forestfuture/active-record";

// #region previously-new
export class Article extends Model.define({
  id: { type: "integer", null: false },
  title: { type: "string", null: false },
  viewCount: { type: "integer", null: false },
  isPinned: { type: "boolean", null: false },
  viewedAt: "datetime",
  updatedAt: "datetime",
}) {
  static {
    this.afterSave((article) => {
      if (article.isPreviouslyNewRecord()) {
        console.log(`New article: ${article.title}`); // not after later saves
      }
    });
  }
}
// #endregion previously-new

export async function examples(id: number) {
  // #region in-memory
  const article = await Article.find(id);
  article.increment("viewCount"); // viewCount + 1, not saved yet
  article.toggle("isPinned");
  await article.save();
  // #endregion in-memory

  // #region columns
  await article.incrementColumn("viewCount"); // adds 1 in the row, now
  await article.toggleColumn("isPinned");
  await article.updateColumns({ title: "Renamed" }); // no validations, callbacks, or updatedAt
  // #endregion columns

  // #region touching
  await article.touch(); // sets updatedAt to now
  await article.touch("viewedAt"); // sets viewedAt and updatedAt
  await article.touch({ time: new Date("2026-01-01T00:00:00Z") });
  await Article.where({ isPinned: true }).touchAll(); // every pinned article, in one statement
  // #endregion touching

  // #region counters
  await Article.updateCounters(id, { viewCount: 1 });
  await Article.where({ isPinned: true }).updateCounters({ viewCount: 10 });
  await Article.incrementCounter("viewCount", [id], { by: 5, touch: true }); // sets updatedAt too
  // #endregion counters

  // #region scoped-counter
  await Article.where({ id }).updateCounters({ viewCount: 1 }); // keeps the default scope
  // #endregion scoped-counter
  return Article.find(id);
}
