# Changelog

## v0.1.0—2025-12-12

- Added JSON Schema 2020-12 output format with `issues` array and `summary` aggregation (breaking for consumers of the old flat schema).
- Added upstream/midstream/downstream sample skills with YAML frontmatter.
- Added local CLI (`river run`) with diff optimization, cost estimation, and dry-run fallback behavior.
- Added composite GitHub Action (`.github/actions/river-reviewer`) and refreshed README/tutorial examples.
- Added the Riverbed Memory design draft under `pages/explanation/`.
- Added additional downstream and midstream skills (coverage gaps, flaky tests, test existence, TypeScript null safety).

### Breaking changes

- `schemas/output.schema.json` now returns an array of issues plus a summary object. Any tools/CI consuming the previous structure must update.

### Release checklist

- [ ] Tag release: `git tag v0.1.0` and `git push origin v0.1.0`.
- [ ] (Optional) Add alias tag `v0` pointing to the same commit for workflows that want a floating tag.
- [ ] Publish a GitHub Release with these notes and links to the sample skills and schema files.
