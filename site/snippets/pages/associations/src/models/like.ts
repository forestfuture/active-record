import { belongsTo } from "@forestfuture/active-record";
import { ApplicationRecord } from "./application-record";
import { Photo } from "./photo";
import { Video } from "./video";

export class Like extends ApplicationRecord {
  likeable = belongsTo([Photo, Video]); // its own likeableType and likeableId
}
