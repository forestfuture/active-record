import { Model } from "@forestfuture/active-record";

export class Label extends Model.define({
  id: { type: "integer", null: false },
  name: { type: "string", null: false },
  color: "string",
}) {
  static table = "labels";
}

const pickColor = () => "green";

export async function findOrCreate(): Promise<unknown> {
  // #region find-or-create
  const travel = await Label.findOrCreateBy({ name: "travel" }); // found, or created
  const food = await Label.findOrInitializeBy({ name: "food" }); // found, or built and not saved
  // #endregion find-or-create

  // #region create-with
  const blueLabels = Label.createWith({ color: "blue" });
  const music = await blueLabels.findOrCreateBy({ name: "music" }); // created blue
  // #endregion create-with

  // #region init
  const art = await Label.findOrCreateBy({ name: "art" }, (label) => {
    label.color = pickColor(); // only when it's created
  });
  // #endregion init

  // #region create-or-find
  const news = await Label.createOrFindBy({ name: "news" }); // created, or found
  // #endregion create-or-find

  return [travel, food, music, art, news].map((label) => ({
    name: label.name,
    color: label.color,
    saved: label.isPersisted(),
  }));
}
