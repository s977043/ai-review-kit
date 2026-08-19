# 配布プラグインコマンド一覧（`commands/`）

River Review プラグインとして配布されるスラッシュコマンドの一覧です（`.claude-plugin/plugin.json` の `commands` が参照します）。リポジトリ開発専用のコマンドは [`.claude/commands/`](../../.claude/commands/) に残しています（#996）。

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

## なぜ `commands/README.md` ではなくここに置くのか

`commands/` はプラグインの配布サーフェスであり、`claude plugin validate` は `commands/` 直下の `*.md` を**すべてコマンドとして走査**する。README も例外ではないため、そこに置くと配布物に実行できない `/README` コマンドが混ざる（frontmatter を足しても走査対象からは外れない）。ドキュメントは配布サーフェスの外に置き、`commands/` には実際のコマンドだけを残すのが安全です。

一方 [`.claude/commands/README.md`](../../.claude/commands/README.md) はリポジトリ開発専用ディレクトリの索引であり、配布されず validator の走査対象にもならないため、コマンドと同居したままで問題ない。

配置先が `docs/development/` である理由は [DOCUMENTATION.md](../policy/DOCUMENTATION.md) のとおりで、この文書は公開サイト（`pages/`）向けではなく、メンテナ向けの開発リファレンスだからです。
