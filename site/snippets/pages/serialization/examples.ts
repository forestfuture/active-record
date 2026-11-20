import { Account } from "./src/models/account";

export async function serializing() {
  // #region json
  const account = await Account.findByOrThrow({ email: "jane@example.com" });

  const body = JSON.stringify(account); // dates as ISO strings, passwordDigest and apiKey left out
  const attributes = account.attributes(); // every attribute, dates as Date
  // #endregion json
  return { account, body, attributes };
}

// #region response
export async function show(request: Request): Promise<Response> {
  const email = new URL(request.url).searchParams.get("email") ?? "";
  const account = await Account.findBy({ email });
  return account ? Response.json(account) : new Response("Not found", { status: 404 });
}
// #endregion response
