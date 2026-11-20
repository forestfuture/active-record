import { gte } from "@forestfuture/active-record";
import { ApplicationRecord } from "./application-record";

export class Post extends ApplicationRecord {
  static published = this.scope((q) => q.whereNot({ publishedAt: null }));
  static publishedSince = this.scope((q, since: Date) => q.where({ publishedAt: gte(since) }));
}
