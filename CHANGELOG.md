# Changelog

## v0.1.1—2025-12-13

- Fixed the composite GitHub Action to work reliably when used from external repositories (installing dependencies from the action repo root).
- Added idempotent PR comment posting (updates an existing River Reviewer comment instead of duplicating).
- Added a minimal always-on "Hello Skill" to guarantee end-to-end behavior on any diff.
- Aligned milestone title formatting with `.github/workflows/auto-milestone.yml` and adjusted dash normalization logic accordingly.
- Updated CLI output for PR comments and tuned prompts to prefer Japanese review messages.

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

- [ ] `main` の更新後、Release PR（release-please）が作成されていることを確認する。
- [ ] Release PR をマージしてリリースを確定する（タグ発行と GitHub Release は CI が実施）。
- [ ] `v0` のようなエイリアスタグは CI が最新リリースへ追従させる。
