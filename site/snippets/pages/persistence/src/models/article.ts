import { ApplicationRecord } from "./application-record";

export class Article extends ApplicationRecord {
  static {
    this.afterSave((article) => {
      if (article.isPreviouslyNewRecord()) {
        console.log(`New article: ${article.title}`); // not after later saves
      }
    });
  }
}
