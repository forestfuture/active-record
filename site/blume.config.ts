import { defineConfig } from "blume";

export default defineConfig({
  title: "d1-record",
  description: "A Rails-inspired Active Record for Cloudflare Workers and D1.",
  github: { owner: "forestfuture", repo: "d1-record", dir: "site" },
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
        "Active Record is `@forestfuture/active-record` on npm, a Rails-inspired Active Record for Cloudflare Workers, and `@forestfuture/d1-record` is its adapter for D1. Install its agent skill, with the rules for writing Active Record code, using `npx skills add forestfuture/active-record`. Every behavior the tests prove is in the [behavior contract](https://github.com/forestfuture/active-record/blob/main/docs/contract.md). The installed package ships this guide for its own version at `node_modules/@forestfuture/active-record/llms-full.txt`.",
    },
    // Published at /.well-known/agent-skills/active-record/SKILL.md, in place of Blume's generated skill.
    skills: "../packages/active-record/skills",
    contentSignals: { aiTrain: false },
  },
  deployment: { site: "https://d1-record.forestfuture.dev" },
});
