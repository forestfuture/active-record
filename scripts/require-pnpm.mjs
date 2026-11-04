// Refuses to publish a package with anything but pnpm, as each package's `prepublishOnly` (#277).
// In the repo, a package's `exports` point at its source and the D1 adapter's peer dependency is
// `workspace:*`; pnpm swaps in `publishConfig.exports` and the core's version when it packs, and
// npm doesn't, so `npm publish` would upload a package no app could import or install.
const agent = process.env["npm_config_user_agent"] ?? "";

if (!agent.startsWith("pnpm/")) {
  console.error(
    "Publish with pnpm (`pnpm publish`, or `pnpm pack` then `npm publish <tarball>`), not npm: " +
      "npm leaves this package's exports pointing at src/ and its workspace: version unresolved.",
  );
  process.exit(1);
}
