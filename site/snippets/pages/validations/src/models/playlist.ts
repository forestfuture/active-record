import { hasMany } from "@forestfuture/arbor";
import { ApplicationRecord } from "./application-record";
import { Track } from "./track";

export class Playlist extends ApplicationRecord {
  tracks = hasMany(Track);

  static {
    this.validatesAssociated("tracks");
  }
}
