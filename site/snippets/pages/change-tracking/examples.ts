import { User } from "./src/models/user";

export async function changing() {
  // #region changes
  const user = await User.findByOrThrow({ email: "jane@example.com" });
  user.email = "jane@work.example";

  console.log(user.changed()); // ["email"]
  console.log(user.attributeWas("email")); // "jane@example.com"
  console.log(user.isAttributeChanged("email", { from: "jane@example.com" })); // true

  await user.save(); // logs "Email changed from jane@example.com to jane@work.example"
  console.log(user.isChanged()); // false
  // #endregion changes
  return user;
}

export async function restoring() {
  // #region restore
  const user = await User.findByOrThrow({ email: "jane@example.com" });
  user.assign({ email: "typo@example", role: "owner" });
  user.restoreAttributes(["email"]); // back to "jane@example.com"; role stays changed
  // #endregion restore
  return user;
}
