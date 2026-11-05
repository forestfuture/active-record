import { expect, test } from "vite-plus/test";

// The Postgres projects are left out without DATABASE_URL, so a local run needs no server (#269).
// CI must run them, so there a missing DATABASE_URL fails here rather than passing without them.
test.runIf(process.env["CI"] !== undefined)(
  "CI gives the Postgres projects a server through DATABASE_URL",
  () => {
    expect(
      process.env["DATABASE_URL"],
      "the Postgres projects need DATABASE_URL in CI",
    ).toBeTruthy();
  },
);
