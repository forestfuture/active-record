import { createServer, type AddressInfo, type Socket } from "node:net";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { Model } from "../../../packages/active-record/src/index.ts";
import { connect } from "../../../packages/pg-record/src/index.ts";

class User extends Model.define({ id: { type: "integer", null: false } }) {
  static table = "users";
}

/** A host that takes a client's connection and never answers it, as one that can't be reached. */
async function silentHost() {
  const sockets = new Set<Socket>();
  let arrived = () => {};
  const reached = new Promise<void>((resolve) => (arrived = resolve));
  const server = createServer((socket) => {
    sockets.add(socket);
    arrived();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: (query = "") => `postgres://app@127.0.0.1:${port}/app${query}`,
    /** Settles once a client has connected: by then, `pg` has started its connect timer. */
    reached,
    close: () => {
      for (const socket of sockets) socket.destroy();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** `pg`'s own error for an open that took too long. */
const timedOut = { message: "timeout expired" };

/** A query's outcome, and whether it has one yet. */
function watch(query: Promise<unknown>) {
  const state = { settled: false };
  const outcome = query.then(
    () => "resolved",
    (error: unknown) => error,
  );
  void outcome.finally(() => (state.settled = true));
  return Object.assign(state, { outcome });
}

describe("opening a pg-record client times out (#292)", () => {
  let host: Awaited<ReturnType<typeof silentHost>>;

  beforeEach(async () => {
    host = await silentHost();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });
  afterEach(async () => {
    vi.useRealTimers();
    await host.close();
  });

  test("a host that never answers fails the query after 10 seconds", async () => {
    const query = watch(connect(host.url()).model(User).count());
    await host.reached;
    await vi.advanceTimersByTimeAsync(9_999);
    expect(query.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await query.outcome).toMatchObject(timedOut);
  });
});
