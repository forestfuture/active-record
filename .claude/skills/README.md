# Project skills

Installed from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT, see `LICENSE-mattpocock-skills`), and `blume` from [haydenbleasel/blume](https://github.com/haydenbleasel/blume) (MIT, see `LICENSE-blume`), the guide site’s framework, which points agents at the docs bundled with the installed package. The security skills come from [trailofbits/skills](https://github.com/trailofbits/skills) (`differential-review`, `supply-chain-risk-auditor`; CC BY-SA 4.0, see `LICENSE-trailofbits-skills`) and [getsentry/skills](https://github.com/getsentry/skills) (`security-review`; Apache-2.0, see `LICENSE-getsentry-skills`, with OWASP-derived references under CC BY-SA 4.0 in its own `LICENSE`). The exact versions are pinned in `/skills-lock.json`. Claude Code loads them automatically in this repo. Other agents can read each `SKILL.md` as plain instructions. `docs/agents/workflow.md` explains how they fit together.

These are **copies, not symlinks**, so they work for anyone who clones the repo. They're also excluded from formatting (`fmt.ignorePatterns` in `vite.config.ts`), so they stay exactly as published.

The repo-level configuration these skills read (`docs/agents/issue-tracker.md`, `triage-labels.md` and `domain.md`) comes from the `/setup-matt-pocock-skills` skill. That skill configures the repo; it doesn't install skills.

Inside this repo, run the CLI with `pnpm dlx`. `npx` fails here, because `package.json` declares pnpm as the package manager.

## Updating

```sh
pnpm dlx skills update -p
```

Then, before committing:

1. **Check that the skills are still copies:** `ls -la .claude/skills`. Every skill should be a directory, not a symlink (`->`). If any became symlinks, remove them and reinstall them with `--copy` (see *Adding a skill*).
2. **Review the changes:** `git diff .claude/skills skills-lock.json`. Skills run with full agent permissions, so read what changed.
3. **Check the workflow:** if a skill's behavior changed, make sure `docs/agents/workflow.md` still describes it.
4. Run `vp check` and commit.

## Adding a skill

```sh
pnpm dlx skills add <owner/repo> --skill <name> -a claude-code --copy -y
```

Leaving out `--copy` creates symlinks into your home directory, which only work on your machine. Then follow steps 1–4 above.
