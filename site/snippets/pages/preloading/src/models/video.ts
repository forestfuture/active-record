import { hasMany } from "@forestfuture/active-record";
import { ApplicationRecord } from "./application-record";
import { Like } from "./like";

export class Video extends ApplicationRecord {
  likes = hasMany(Like, { as: "likeable" }); // Like's likeableType is "Video"
}
