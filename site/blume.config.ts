import { defineConfig } from "blume";

export default defineConfig({
  title: "Active Record",
  description: "A Rails-inspired Active Record for Cloudflare Workers, on D1 or Postgres.",
  github: { owner: "forestfuture", repo: "active-record", dir: "site" },
  lastModified: "git",
  // Blume's own header shows it on the 404 page; components/HeaderLogo.astro replaces that header
  // logo everywhere else.
  logo: "/icon.svg",
  // Cloudflare Web Analytics counts page views, turned on for the zone in the dashboard. Adding
  // Blume's cloudflare() adapter as well would count each view twice. It has no event API, so the
  // page rating stays off until its votes have somewhere to go.
  feedback: false,
  theme: { accent: { light: "#2f6b3f", dark: "#8cc79a" } },
  footer: {
    copyright: "A ForestFuture project",
    links: [{ label: "ForestFuture", href: "https://forestfuture.dev" }],
  },
  agents: {
    llmsTxt: {
      details:
        "Active Record is `@forestfuture/active-record` on npm, a Rails-inspired Active Record for Cloudflare Workers, with an adapter for each database: `@forestfuture/d1-record` for D1, and `@forestfuture/pg-record` for Postgres. Install its agent skill, with the rules for writing Active Record code, using `npx skills add forestfuture/active-record`. Every behavior the tests prove is in the [behavior contract](https://github.com/forestfuture/active-record/blob/main/docs/contract.md). The installed package ships this guide for its own version at `node_modules/@forestfuture/active-record/llms-full.txt`.",
    },
    // Published at /.well-known/agent-skills/active-record/SKILL.md, in place of Blume's generated skill.
    skills: "../packages/active-record/skills",
    contentSignals: { aiTrain: false },
  },
  deployment: { site: "https://active-record.forestfuture.dev" },
});
