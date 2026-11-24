import { hasMany } from "@forestfuture/arbor";
import { ApplicationRecord } from "./application-record";
import { Like } from "./like";

export class Photo extends ApplicationRecord {
  likes = hasMany(Like, { as: "likeable" }); // Like's likeableType is "Photo"
}
