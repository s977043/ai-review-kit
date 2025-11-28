# Changelog

## v0.1.0 (Draft) — 2025-11-28

- Added JSON Schema 2020-12 output format with `issues` array and `summary` aggregation (breaking for consumers of the old flat schema).
- Added upstream/midstream/downstream sample skills with YAML frontmatter.
- Refreshed README/docs to the River Reviewer worldview and updated GitHub Action examples to `@v1` (replace with the latest tag when published).
- Added the Riverbed Memory design draft under `docs/explanation/`.

### Breaking changes

- `schemas/output.schema.json` now returns an array of issues plus a summary object. Any tools/CI consuming the previous structure must update.

### Release checklist

- [ ] Merge PR #40 to `main`.
- [ ] Tag release: `git tag v0.1.0` and `git push origin v0.1.0`.
- [ ] (Optional) Add alias tag `v1` pointing to the same commit to match docs examples, or adjust README to the chosen tag.
- [ ] Publish a GitHub Release with these notes and links to the sample skills and schema files.
