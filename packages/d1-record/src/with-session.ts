// `withSession`: one request's D1 Session, started from the bookmark it carries, and the bookmark sent back (#220).
import { withDatabase } from "@forestfuture/active-record";
import { connectForRequest, type ConnectOptions, type Database } from "./database.ts";

/** How `withSession` opens the request's Database, and where its bookmark travels. */
export type SessionOptions = Omit<ConnectOptions, "session"> & {
  /** Where a request with no bookmark starts its Session: `"first-unconstrained"` unless set. */
  start?: D1SessionConstraint;
} & (
    | {
        /** The cookie the bookmark travels in: `"d1-bookmark"` unless set. */
        cookie?: string;
        header?: never;
      }
    | {
        cookie?: never;
        /** The header the bookmark travels in, on the request and the response, instead of a cookie. */
        header: string;
      }
  );

type Handler = (db: Database) => Response | Promise<Response>;

/** Where a bookmark is read from and written to. */
interface Carrier {
  read(request: Request): string | undefined;
  write(headers: Headers, bookmark: string): void;
}

/**
 * Runs `fn` with a Database whose Session starts from the request's bookmark, so the request
 * reads at least as new as the user's last write, from any replica, and sets the Session's
 * latest bookmark on the response it returns. An error from `fn` reaches the caller unchanged.
 */
export function withSession(request: Request, binding: D1Database, fn: Handler): Promise<Response>;
export function withSession(
  request: Request,
  binding: D1Database,
  options: SessionOptions,
  fn: Handler,
): Promise<Response>;
export async function withSession(
  request: Request,
  binding: D1Database,
  ...args: [Handler] | [SessionOptions, Handler]
): Promise<Response> {
  const [options, fn] = args.length === 1 ? [{}, args[0]] : args;
  const { start = "first-unconstrained", cookie, header, ...connectOptions } = options;
  const carrier = carrierFor(cookie, header);
  const bookmark = carrier.read(request);
  const db = connectForRequest(binding, bookmark, start, connectOptions);
  const response = await withDatabase(db, () => fn(db));
  // Before its first query, a Session may have no bookmark of its own: the request's still holds.
  const latest = db.bookmark() ?? bookmark;
  if (latest === undefined) return response;
  return withHeaders(response, (headers) => carrier.write(headers, latest));
}

function carrierFor(cookie: string | undefined, header: string | undefined): Carrier {
  if (header === undefined) return cookieCarrier(cookie ?? "d1-bookmark");
  if (cookie !== undefined) {
    throw new TypeError("withSession takes a cookie or a header for the bookmark, not both");
  }
  return headerCarrier(header);
}

function headerCarrier(name: string): Carrier {
  return {
    read: (request) => request.headers.get(name) || undefined,
    write: (headers, bookmark) => headers.set(name, bookmark),
  };
}

function cookieCarrier(name: string): Carrier {
  return {
    read: (request) => cookieValue(request, name),
    write: (headers, bookmark) =>
      headers.append("set-cookie", `${name}=${bookmark}; Path=/; HttpOnly; Secure; SameSite=Lax`),
  };
}

/**
 * `response` with its headers changed by `change`. A response whose headers can't change (one
 * from `fetch()` or `Response.redirect()`) is copied first; any other is returned as it is, so a
 * WebSocket upgrade keeps its socket.
 */
function withHeaders(response: Response, change: (headers: Headers) => void): Response {
  try {
    change(response.headers);
    return response;
  } catch {
    const copy = new Response(response.body, response);
    change(copy.headers);
    return copy;
  }
}

/** The value of the request's cookie named `name`, if it sent one that isn't empty. */
function cookieValue(request: Request, name: string): string | undefined {
  for (const pair of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...value] = pair.split("=");
    if (key?.trim() === name) return value.join("=").trim() || undefined;
  }
  return undefined;
}
