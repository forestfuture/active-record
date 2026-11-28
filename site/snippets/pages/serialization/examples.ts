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

export async function including() {
  // #region include
  const account = await Account.includes("orders").findByOrThrow({ email: "jane@example.com" });

  const body = account.toJSON({ include: "orders" });
  console.log(body.orders); // [{ id: "…", accountId: "…", reference: "A-1001", … }]
  // #endregion include
  return body;
}

export async function choosing() {
  // #region choose
  const account = await Account.findByOrThrow({ email: "jane@example.com" });

  const summary = account.toJSON({ only: ["id", "email"], methods: ["domain"] });
  console.log(summary); // { id: "…", email: "jane@example.com", domain: "example.com" }

  const withoutDates = account.toJSON({ except: ["createdAt", "updatedAt"] });
  // #endregion choose
  return withoutDates;
}

export async function nesting() {
  // #region nested
  const account = await Account.includes("orders").findByOrThrow({ email: "jane@example.com" });

  const body = account.toJSON({
    only: ["email"],
    include: { orders: { only: ["reference", "totalCents"] } },
  });
  console.log(body); // { email: "jane@example.com", orders: [{ reference: "A-1001", totalCents: 4200 }] }
  // #endregion nested
  return body;
}
