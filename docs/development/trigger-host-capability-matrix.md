# Trigger Host Capability Matrix（#2054 PR-1）

Review Placement & Trigger Contract（#2054、Epic #2011）の Phase 1 として、`flows/entry-map.json` に `triggers` を additive 追加しました。本ドキュメントは、5 つの中立 trigger を各 host が現時点でどの表面から発火できるかを実測から書き起こしたものです。

- registry の実体: `flows/entry-map.json` の `triggers`（entry 名を参照し、Flow id を重複定義しない）
- schema: `schemas/flow-entry-map.schema.json` の `triggers` / `$defs.trigger` / `$defs.neutralProse`
- 検証: `tests/flow-definitions.test.mjs` の `trigger registry (#2054 PR-1)`
- 前提となる 8 入口: [flow-contract.md](./flow-contract.md)（core 4）と [upstream-review-flows.md](./upstream-review-flows.md)（上流 4）

本 PR は宣言だけです。`src/**` と `runners/**` は `triggers` を読まず、observe mode の不変条件（同テストの `no runtime module loads flows/`）はそのまま緑です。ただし #2054 PR-3 以降、`flows/` を読む runtime モジュールは `src/lib/flow-loader.mjs` のみであり、同テストは offenders がこの 1 件と一致することを検査します（#2103）。

## 5 つの中立 trigger

| trigger           | 解決先 entry                                                              | 予算 / 制約                        | 必須証跡（Flow `inputs` 語彙）    |
| ----------------- | ------------------------------------------------------------------------- | ---------------------------------- | --------------------------------- |
| `artifact-ready`  | 上流 4 入口 + `review-plan` / `review-replan`（`selectBy: artifactKind`） | 明示 checkpoint                    | 選択された Flow の required input |
| `after-change`    | なし（`entries: []`）                                                     | `profile: fast-verification`       | なし（Flow を起動しない）         |
| `task-checkpoint` | `review-task`                                                             | 明示 checkpoint                    | `tasks` / `diff`                  |
| `before-publish`  | `review-final`                                                            | 明示 checkpoint                    | `requirements` / `diff`           |
| `before-merge`    | `review-final`                                                            | `independence: execution-isolated` | `requirements` / `diff`           |

trigger 名は host 語彙を持ちません。schema は trigger 名を 5 語の `enum` に閉じ、各 trigger の key を `additionalProperties: false` で閉じています。自由記述の `description` だけは `$defs.neutralProse` の `not.pattern` が host 名 / hook 名 / shell / severity / gate 判定語を拒否します。

## host ごとの発火表面（実測）

各セルは「その host に現時点で存在する表面」だけを書いています。表面が無いセルは「なし」であり、将来の adapter で埋める余地を否定するものではありません。

| trigger           | Claude Code                                           | Codex                 | GitHub Action                                                     |
| ----------------- | ----------------------------------------------------- | --------------------- | ----------------------------------------------------------------- |
| `artifact-ready`  | 明示呼び出し（skill / native subagent）               | 明示呼び出し（skill） | なし                                                              |
| `after-change`    | lifecycle hook（Write / Edit 後、現状は format のみ） | なし                  | なし                                                              |
| `task-checkpoint` | 明示呼び出し（skill / native subagent）               | 明示呼び出し（skill） | なし                                                              |
| `before-publish`  | 明示呼び出し（skill / native subagent）               | 明示呼び出し（skill） | workflow event（PR の opened / synchronize / reopened / labeled） |
| `before-merge`    | なし                                                  | なし                  | なし（merge 時点の event は未購読）                               |

### 出典

- Claude Code の capability: `agents/contracts/adapter-map.json` の `runtimes.claude.capabilities` に 4 つある。`read-artifact` / `read-source` / `search-source` / `run-command` で、出典は `agents/river-review.md` の `tools:` 行
- Claude Code の表面: 同ファイル `agents.review-orchestrator.claude.mechanism` が `native-subagent` である。hook は `hooks/hooks.json` の `PostToolUse` で、matcher は `Write|Edit|MultiEdit`、実行内容は `scripts/plugin-format-hook.sh`
- Codex の capability: 同 `runtimes.codex.capabilities`（`read-artifact` / `read-source`）である。出典は `.codex-plugin/plugin.json` の `interface.capabilities: ["Read"]`
- Codex の表面: 同 manifest は `agents` / `commands` / `hooks` のいずれも宣言しないため、`skills/agent-skills/` の skill だけである
- GitHub Action: `agents/contracts/adapter-map.json` に runtime としての登録はない。表の値は `.github/workflows/river-review.yml` の `on:`（`workflow_dispatch` と `pull_request` の `types: [opened, synchronize, reopened, labeled]`）から読んだ
- `workflow_dispatch` は人が起動する明示 checkpoint であり、5 つの trigger のどれか 1 つに固定して対応づけられないため表に載せていない

### 表から導ける制約

- `after-change` を hook から発火できる host は Claude Code だけである。Codex と GitHub Action では、Phase 4-B の方針どおり capability 不足を `skipped` / `manual-required` として記録する側に回る
- `before-merge` はどの host にも表面がない。`independence: execution-isolated` を満たす別 run の実行経路そのものが Phase 5 の対象である
- `run-command` capability を持つのは Claude Code だけである。`after-change` の検査実行は #1401 の trusted allowlist を再利用する Phase 3 の範囲であり、本 registry は command を 1 つも持たない
