import { ApplicationRecord } from "./application-record";

export class Product extends ApplicationRecord {
  static override attributes = {
    archived: { type: "boolean", default: () => false }, // 0 or 1 in a plain INTEGER column
    metadata: "json", // JSON in a plain TEXT column
    legacyNotes: false, // a column this app no longer uses: never read or written
    publicId: { generateId: true }, // generated in code, as a TEXT key is
    title: { aliasOf: "name" }, // another name for name, in queries too
  } as const;

  declare status: "draft" | "published"; // narrower than the column's string
}
