import { column, gte, Model, sql } from "@forestfuture/active-record";
import { schema } from "../db/schema";

// The app's base class, holding the schema `d1-record schema` generated from a Drizzle app's
// migrations (site/snippets/db/schema.ts).
abstract class ApplicationRecord extends Model {
  static override schema = schema;
}

// #region overrides
export class Post extends ApplicationRecord {
  static override attributes = {
    metadata: "json", // text({ mode: "json" }): JSON in a plain TEXT column
    archived: "boolean", // integer({ mode: "boolean" }): 0 or 1
    legacyNotes: false, // a column this app no longer uses: never read or written
  } as const;
}
// #endregion overrides

// #region timestamps
export class Article extends ApplicationRecord {
  static override attributes = {
    publishedAt: { type: "datetime", storage: "unixSeconds" }, // timestamp: seconds
    updatedAt: { type: "datetime", storage: "unixMilliseconds" }, // timestamp_ms: milliseconds
  } as const;
}

export function publishedSince(since: Date) {
  return Article.where({ publishedAt: gte(since) });
}
// #endregion timestamps

// #region fragment
export function publishedBefore(before: Date) {
  const publishedAt = column("publishedAt");
  return Article.where(sql`${publishedAt} < ${publishedAt.value(before)}`);
}
// #endregion fragment
