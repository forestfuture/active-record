# Changesets

Each user-visible change comes with a changeset: a Markdown file here saying whether it's a patch, minor or major change, with a line written for the library's users. Add one with `vp exec changeset`.

On `main`, CI collects them into a **Version Packages** pull request that bumps both packages' version and updates each one's `CHANGELOG.md`. Merging that pull request publishes to npm. See `docs/agents/releasing.md`.
