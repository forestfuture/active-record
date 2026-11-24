import { gte } from "@forestfuture/arbor";
import { ApplicationRecord } from "./application-record";

export class Post extends ApplicationRecord {
  static published = this.scope((q) => q.whereNot({ publishedAt: null }));
  static publishedSince = this.scope((q, since: Date) => q.where({ publishedAt: gte(since) }));
}
