// A host that takes a Postgres client's connection and never answers it, for pg-record's connect timeout (#292).
import { createServer, type AddressInfo, type Socket } from "node:net";

export interface SilentHost {
  /** A connection string to it, with `query` (`?connect_timeout=2`) after its path. */
  url(query?: string): string;
  /** Settles once a client has connected: by then, `pg` has started its connect timer. */
  reached: Promise<void>;
  /** Closes it, and every connection it took. */
  close(): Promise<void>;
}

/** A host that takes a client's connection and never answers it, as one that can't be reached. */
export async function openSilentHost(): Promise<SilentHost> {
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
    reached,
    close: () => {
      for (const socket of sockets) socket.destroy();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
