import { purgeCachedPage } from "../cache";
import { ApplicationRecord } from "./application-record";

export class Article extends ApplicationRecord {
  static {
    this.afterTouch(async (article) => {
      await purgeCachedPage(`/articles/${article.id}`);
    });
  }
}
