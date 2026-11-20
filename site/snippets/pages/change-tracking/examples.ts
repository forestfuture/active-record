import { User } from "./src/models/user";

export async function changing() {
  // #region changes
  const ada = await User.findByOrThrow({ email: "ada@example.com" });
  ada.email = "ada@lovelace.dev";

  console.log(ada.changed()); // ["email"]
  console.log(ada.attributeWas("email")); // "ada@example.com"
  console.log(ada.isAttributeChanged("email", { from: "ada@example.com" })); // true

  await ada.save(); // logs "Email changed from ada@example.com to ada@lovelace.dev"
  console.log(ada.isChanged()); // false
  // #endregion changes
  return ada;
}

export async function restoring() {
  // #region restore
  const ada = await User.findByOrThrow({ email: "ada@example.com" });
  ada.assign({ email: "typo@example", role: "owner" });
  ada.restoreAttributes(["email"]); // back to "ada@example.com"; role stays changed
  // #endregion restore
  return ada;
}
