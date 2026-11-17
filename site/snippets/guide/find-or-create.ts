import { Model } from "@forestfuture/active-record";

export class Tag extends Model.define({
  id: { type: "integer", null: false },
  name: { type: "string", null: false },
  color: "string",
}) {
  static table = "tags";
}

const pickColor = () => "green";

export async function findOrCreate(): Promise<unknown> {
  // #region find-or-create
  const travel = await Tag.findOrCreateBy({ name: "travel" }); // found, or created
  const food = await Tag.findOrInitializeBy({ name: "food" }); // found, or built and not saved
  // #endregion find-or-create

  // #region create-with
  const blueTags = Tag.createWith({ color: "blue" });
  const music = await blueTags.findOrCreateBy({ name: "music" }); // created blue
  // #endregion create-with

  // #region init
  const art = await Tag.findOrCreateBy({ name: "art" }, (tag) => {
    tag.color = pickColor(); // only when it's created
  });
  // #endregion init

  // #region create-or-find
  const news = await Tag.createOrFindBy({ name: "news" }); // created, or found
  // #endregion create-or-find

  return [travel, food, music, art, news].map((tag) => ({
    name: tag.name,
    color: tag.color,
    saved: tag.isPersisted(),
  }));
}
