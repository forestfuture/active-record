import { describe, expect, test } from "vite-plus/test";
import { databaseNameOf, hostOf } from "../../packages/pg-record/cli/urls.ts";

// What `--remote` names for a person to confirm is where pg connects (#285).
describe("a connection string, as a person confirms it", () => {
  test("names the host and database pg connects to, a host parameter's included", () => {
    const url = "postgres://app:pw@localhost/shop?host=db.example.com";

    expect([hostOf(url), databaseNameOf(url)]).toEqual(["db.example.com", "shop"]);
  });

  test("names a socket's folder, and the user's database when the string names none", () => {
    expect(hostOf("postgres://app@/shop?host=/var/run/postgresql")).toBe("/var/run/postgresql");
    expect(databaseNameOf("postgres://app@db.example.com")).toBe("app");
  });
});
