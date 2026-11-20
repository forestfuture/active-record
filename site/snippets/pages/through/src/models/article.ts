import { belongsTo, hasMany } from "@forestfuture/active-record";
import { ApplicationRecord } from "./application-record";
import { Author } from "./author";
import { Tag } from "./tag";
import { Tagging } from "./tagging";

export class Article extends ApplicationRecord {
  author = belongsTo(Author);
  taggings = hasMany(Tagging);
  tags = hasMany(Tag, { through: "taggings" }); // each tagging's tag
}
