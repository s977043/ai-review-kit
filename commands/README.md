---
description: 'Index of the River Review distributed plugin commands (reference only; not a runnable command).'
---

# commands/ (distributed plugin commands)

Slash commands shipped as part of the River Review plugin (referenced by `.claude-plugin/plugin.json`). Separated from repo-development commands (which stay in [`.claude/commands/`](../.claude/commands/)) per #996.

| Command         | File              | Purpose                                                                                |
| --------------- | ----------------- | -------------------------------------------------------------------------------------- |
| `/check`        | `check.md`        | Run quality checks (lint + test)                                                       |
| `/pr`           | `pr.md`           | Draft PR description                                                                   |
| `/skill`        | `skill.md`        | Find or create skill definition                                                        |
| `/review-local` | `review-local.md` | Self-review current diff                                                               |
| `/challenge`    | `challenge.md`    | Adversarial review (pre-mortem, war game)                                              |
| `/review-team`  | `review-team.md`  | Parallel multi-role review with consensusLevel and Tech Lead report                    |
| `/setup-team`   | `setup-team.md`   | Set up River Review in a project (`.river/rules.md`, plugin install, integration mode) |

> **整合性**: 配布対象コマンドの追加・変更時は `.claude-plugin/plugin.json` の `commands` と CLAUDE.md `Custom Commands` 表も更新すること。この表と `commands/*.md` の一致は `npm run check:doc-enum`（`meta:validate` 経由で CI 必須チェック）が機械検証する。
