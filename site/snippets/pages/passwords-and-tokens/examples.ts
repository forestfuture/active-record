import { sendResetEmail } from "./src/email";
import { Admin } from "./src/models/admin";
import { User } from "./src/models/user";

// #region sign-up
export async function signUp(request: Request): Promise<Response> {
  const form = await request.formData();
  const permitted = User.permit(form, "email", "password", "passwordConfirmation");
  const user = await User.create(permitted);
  if (!user.isPersisted()) {
    return Response.json({ errors: user.errors.fullMessages() }, { status: 422 });
  }
  return Response.json(user, { status: 201 }); // no password, digest, or token in it
}
// #endregion sign-up

export async function storing() {
  // #region digest
  const user = User.build({ email: "jane@example.com", password: "correct horse battery" });
  console.log(user.passwordDigest === null); // true, until the user is saved

  await user.saveOrThrow();
  const isHashed = user.passwordDigest?.startsWith("$pbkdf2-sha256$") === true;
  console.log(isHashed); // true
  // #endregion digest
  return user;
}

export async function checking() {
  // #region authenticate
  const user = await User.findByOrThrow({ email: "jane@example.com" });

  const isSignedIn = (await user.authenticate("correct horse battery")) !== false;
  console.log(isSignedIn); // true
  // #endregion authenticate
  return isSignedIn;
}

// #region sign-in
export async function signIn(request: Request): Promise<Response> {
  const form = await request.formData();
  const { email = "", password = "" } = User.permit(form, "email", "password");
  const user = await User.authenticateBy({ email, password });
  if (user === null) return new Response("Wrong email or password", { status: 401 });
  return Response.json({ token: user.authToken });
}
// #endregion sign-in

export async function changing() {
  // #region challenge
  const user = await User.findByOrThrow({ email: "jane@example.com" });

  const isChanged = await user.update({
    password: "staple battery horse",
    passwordConfirmation: "staple battery horse",
    passwordChallenge: "correct horse battery", // the current password
  });
  console.log(isChanged); // false if the challenge isn't the current password
  // #endregion challenge
  return { user, isChanged };
}

export async function hashingWithBcrypt() {
  // #region bcrypt
  const admin = await Admin.create({ email: "sam@example.com", password: "correct horse battery" });
  const isBcrypt = admin.passwordDigest?.startsWith("$2b$10$") === true;
  console.log(isBcrypt); // true
  // #endregion bcrypt
  return admin;
}

export async function tokens() {
  // #region token
  const user = User.build({ email: "sam@example.com", password: "correct horse battery" });
  console.log(user.authToken?.length); // 24, such as "pX27zsMN2ViQKta1bGfLmVJE"
  await user.saveOrThrow();

  const found = await User.findBy({ authToken: user.authToken });
  // #endregion token
  return { user, found };
}

export async function regenerating() {
  // #region regenerate
  const user = await User.findByOrThrow({ email: "sam@example.com" });

  await user.regenerateAuthTokenOrThrow(); // saves a new token, so the old one stops working
  // #endregion regenerate
  return user;
}

// #region reset-request
export async function requestReset(request: Request): Promise<Response> {
  const { email = "" } = User.permit(await request.formData(), "email");
  const user = await User.findBy({ email });
  if (user !== null) {
    const token = await user.passwordResetToken(); // lasts 15 minutes
    await sendResetEmail(email, `https://example.com/reset?token=${token}`);
  }
  return new Response("Check your email", { status: 202 }); // the same whether the email is known
}
// #endregion reset-request

// #region reset
export async function resetPassword(request: Request): Promise<Response> {
  const form = await request.formData();
  const user = await User.findByPasswordResetToken(form.get("token"));
  if (user === null) return new Response("That link has expired", { status: 400 });
  const isReset = await user.update(User.permit(form, "password", "passwordConfirmation"));
  if (!isReset) return Response.json({ errors: user.errors.fullMessages() }, { status: 422 });
  return new Response(null, { status: 204 }); // the link stops working: the password changed
}
// #endregion reset

export async function confirmingEmail() {
  // #region email-confirmation
  const user = await User.findByOrThrow({ email: "jane@example.com" });
  const token = await user.generateTokenFor("emailConfirmation");

  const confirmed = await User.findByTokenFor("emailConfirmation", token);
  console.log(confirmed?.email); // "jane@example.com", until the email changes or a day passes
  // #endregion email-confirmation
  return { user, token, confirmed };
}

export async function signingIds() {
  // #region signed-id
  const user = await User.findByOrThrow({ email: "jane@example.com" });
  const signedId = await user.signedId({ purpose: "unsubscribe", expiresIn: { days: 30 } });

  const found = await User.findSigned(signedId, { purpose: "unsubscribe" });
  console.log(found?.email); // "jane@example.com"
  console.log(await User.findSigned(signedId)); // null: it was signed for unsubscribing
  // #endregion signed-id
  return { user, signedId, found };
}
