# Changelog

## [0.2.0](https://github.com/s977043/river-reviewer/compare/v0.1.1...v0.2.0) (2025-12-26)


### Features

* add agent skills validation flow ([e64cc9b](https://github.com/s977043/river-reviewer/commit/e64cc9ba854ffc9f25a4943205fef99713ab003f))
* add availability and communication skills ([62c65c9](https://github.com/s977043/river-reviewer/commit/62c65c94fa0e83ec873a2c6983c1a15048b2930f))
* add availability and communication skills ([652a768](https://github.com/s977043/river-reviewer/commit/652a7681a53eb1217af9ba6797cf22edfbb86bbd))
* add Copilot instructions and agents to integrate with skills ([3c1d6c6](https://github.com/s977043/river-reviewer/commit/3c1d6c6560525cb8b0ea6cfed9f0ba88df25c0fb))
* add core review skills and fixtures evaluation ([#148](https://github.com/s977043/river-reviewer/issues/148)) ([59862d2](https://github.com/s977043/river-reviewer/commit/59862d29393bee5de702202d2b6e3328ef324c33))
* add trigger support to skills schema ([ab3c65c](https://github.com/s977043/river-reviewer/commit/ab3c65c46963971709b32947fb726962a5227a31))
* add upstream api versioning compatibility skill ([ebb6171](https://github.com/s977043/river-reviewer/commit/ebb61712915e309d4bbe22da6904b30777799795))
* add upstream dr multiregion skill ([61afd60](https://github.com/s977043/river-reviewer/commit/61afd609766d2aba4fd65aff471bbea0035495b1))
* enhance skill loader for manifest-driven architecture ([3267205](https://github.com/s977043/river-reviewer/commit/32672053e7cb2e4d241a93012bdb3769d7e800fb))
* expand upstream architecture review skills ([a6bf571](https://github.com/s977043/river-reviewer/commit/a6bf571bd72969b37d38727bf41eafcdc0568f38))
* implement Skill-based Architecture ([#205](https://github.com/s977043/river-reviewer/issues/205)) ([ff82ba0](https://github.com/s977043/river-reviewer/commit/ff82ba03705685f48acfd69d2947eca71a618f28))
* **skills:** add test scaffolding skills for Laravel, Next.js, React, Remix, and Vue.js ([956ae40](https://github.com/s977043/river-reviewer/commit/956ae40d194e330d98296209be055c6f41ac95cd))
* support skipping by PR labels and document config ([d350072](https://github.com/s977043/river-reviewer/commit/d3500728b5c259ead121a686783770a2d3dc7377))
* 指摘フォーマットに Evidence を必須化 ([#139](https://github.com/s977043/river-reviewer/issues/139)) ([5de3c2d](https://github.com/s977043/river-reviewer/commit/5de3c2d2a272b0230bbcf02f68c4d84c0b631e9f))


### Bug Fixes

* address Copilot review comments for scheduled validation workflows ([4d04932](https://github.com/s977043/river-reviewer/commit/4d04932be4ba2b7b18c43d4255c510be0e5da19e))
* address review comments on PR [#201](https://github.com/s977043/river-reviewer/issues/201) ([1460117](https://github.com/s977043/river-reviewer/commit/14601176aa914c0cf369b1f8becb44a769231a4d))
* apply review feedback - remove redundant code and add comprehensive tests ([d9f39cc](https://github.com/s977043/river-reviewer/commit/d9f39ccc28555f3bb806499de56e2716b6841402))
* avoid merging arrays and objects in config merge ([18eb1ec](https://github.com/s977043/river-reviewer/commit/18eb1ec8c1aeb6634e9cd4a57c48cbd5384d2ebf))
* **docs:** update project link to repository Projects page to resolve lychee 404 ([#198](https://github.com/s977043/river-reviewer/issues/198)) ([#203](https://github.com/s977043/river-reviewer/issues/203)) ([b9db673](https://github.com/s977043/river-reviewer/commit/b9db673fcd394912372a7bc7fe2fcdb65b66d22a))
* enforce trigger precedence and tests ([40a7a39](https://github.com/s977043/river-reviewer/commit/40a7a392c60d0c8cd0eba822e247b2f5c5c69d94))
* harden config loader validation ([244fa53](https://github.com/s977043/river-reviewer/commit/244fa53486626553d1c99ca65553377f1b2b9f16))
* keep vercel root at / ([#213](https://github.com/s977043/river-reviewer/issues/213)) ([19970c0](https://github.com/s977043/river-reviewer/commit/19970c03d057b0cea049acfa88acd19dd9b2e0d8))
* normalize instruction handling for YAML skills ([eaa5344](https://github.com/s977043/river-reviewer/commit/eaa5344f69ad60ddde70302ec9626e7383fcb2e7))
* regenerate corrupted package-lock.json to fix CI failures ([056fd93](https://github.com/s977043/river-reviewer/commit/056fd93e65533363f5f6341a1002350af0add10f))
* update GitHub Actions versions to v6 for consistency ([593661b](https://github.com/s977043/river-reviewer/commit/593661b8e0b49ec9932c4c85623bb33b361c9608))
* Vercel siteUrl fallback for ai-review-kit ([#206](https://github.com/s977043/river-reviewer/issues/206)) ([51898ee](https://github.com/s977043/river-reviewer/commit/51898ee0b63832913a691fbf3d9a373410a2e993))


### Performance Improvements

* parallelize agent skills scan ([1e7444b](https://github.com/s977043/river-reviewer/commit/1e7444baa6650fda7fb3071e76b045df27729ebd))

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
