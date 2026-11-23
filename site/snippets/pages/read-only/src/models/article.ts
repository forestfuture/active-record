import { ApplicationRecord } from "./application-record";

export class Article extends ApplicationRecord {
  static override attributes = {
    slug: { readonly: true }, // set when the article is created, never changed after
  } as const;
}
