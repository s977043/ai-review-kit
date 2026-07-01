---
id: 'eval-driven-skill-design'
name: 'Eval-Driven Skill Design'
description: '新規 skill SKILL.md PR で `fixtures/` と `eval/` の happy-path × guard ペアが揃っているかを確認し、欠けている場合は eval cycle (#688) に乗せる手順を案内する。'
version: 0.1.0
category: upstream
phase: upstream
applyTo:
  - 'skills/**/SKILL.md'
inputContext:
  - diff
  - repoConfig
outputKind:
  - findings
  - actions
modelHint: balanced
tags:
  - skill-authoring
  - eval
  - process
  - upstream
severity: minor
dependencies:
  - repo_metadata
---

## Pattern declaration

Primary pattern: Reviewer
Secondary patterns: Tool Wrapper
Why: 新規 skill 追加時に happy-path / guard fixture と eval 配線の有無を診断し、欠けていれば repo-wide eval (#688) に組み込む手順を案内する educator スキル。既存 skill の改修や fixture-only PR では起動しない。

## Goal / 目的

- 新規 `skills/**/SKILL.md` を追加する PR が **検出ケース (happy-path) と抑制ケース (guard) のペア** を fixture として持つことを確認する。
- `eval/promptfoo.yaml` 相当の評価設定または `tests/fixtures/repo-wide-eval/` への登録が用意されているかを確認する。
- 欠けている場合は `npm run eval:fixtures` / `npm run eval:repo-context` をどう通すかを案内する。

## Guidance

### Eval cycle 全体像 (#688 で整備済)

```text
new SKILL.md
  ├─ fixtures/
  │   ├─ <NN>-happy.md        # 検出されるべき diff（必須 1 件以上）
  │   └─ <NN>-guard.md        # 検出してはいけない diff（必須 1 件以上）
  ├─ golden/<NN>-*.md         # promptfoo similar 評価用の代表出力
  ├─ prompt/{system,user}.md  # promptfoo prompts:
  └─ eval/promptfoo.yaml      # contains / not-contains / llm-rubric / similar
```

または `tests/fixtures/repo-wide-eval/` に同じ skill の {happy, guard} ケースを追加し、`tests/fixtures/repo-wide-eval/cases.json` に登録する形でも eval lift が測定できる。

### happy-path × guard ペア convention

- **happy-path fixture**: 「このパターンを必ず検出すること」を保証する。fixture ファイル名に `happy` / `should-detect` を含める。
- **guard fixture**: 「このパターンを誤検出してはいけない」を保証する。fixture ファイル名に `guard` / `false-positive` / `should-not-detect` を含める。
- ペアにすることで `falsePositiveRateWith / detectionRateWith` (`evaluateRepoWideFixtures` メトリクス) が両方測れ、後の改善で **片方だけが破綻するケース** を検知できる。

### eval コマンドと役割

| 対象            | コマンド                    | 何が回るか                                                            |
| --------------- | --------------------------- | --------------------------------------------------------------------- |
| skill schema    | `npm run skills:validate`   | YAML frontmatter / 必須キー検証                                       |
| review fixtures | `npm run eval:fixtures`     | `tests/fixtures/review-eval/cases.json` に登録された skill の出力検証 |
| repo-wide eval  | `npm run eval:repo-context` | `tests/fixtures/repo-wide-eval/` の context-lift / FP rate メトリクス |
| 集約 driver     | `npm run eval:all`          | 上記 + planner / regression / meta を一括実行                         |

ローカルで失敗したまま push しない（CI 通過のみに頼らない）。

### 判断フロー

新規 `skills/**/SKILL.md` の追加 diff を見たとき、次の順で確認する。

1. `fixtures/` ディレクトリが追加されているか？
   - なし → 「happy / guard fixture が必要」を指摘する。
2. happy-path ペアが揃っているか？
   - guard だけ / happy だけ → 片側欠落として指摘する。
3. `eval/promptfoo.yaml` か `tests/fixtures/repo-wide-eval/cases.json` への配線があるか？
   - なし → どちらかを選んで配線する手順を提示する（per-skill promptfoo か repo-wide cases.json か）。
4. すでに揃っている → 何も指摘しない（このスキルは silent でよい）。

## Non-goals / 扱わないこと

- skill の **検出ロジックの妥当性** 自体（それは各 skill の領分）。
- 既存 skill の SKILL.md 改修やドキュメント-only な PR（このスキルは新規 skill 追加 PR のみを対象）。
- `prompt/` や `golden/` 内容のスタイル指摘（fixture / eval の有無のみを確認する）。
- 個別 fixture の diff 内容のレビュー（`scripts/evaluate-review-fixtures.mjs` などが回す）。

## Pre-execution Gate / 実行前ゲート

このスキルは以下を **すべて** 満たさない限り `NO_REVIEW` を返す。

- [ ] 差分に **新規追加された** `skills/**/SKILL.md` が含まれている（既存 SKILL.md の編集のみは対象外）
- [ ] その新規 skill の `fixtures/` または `eval/` の整備状況に未確定がある（差分が `prompt/system.md` のみなど、明らかに整っているケースは除外）

ゲート不成立時の出力:

```text
NO_REVIEW: eval-driven-skill-design — 新規 skill 追加が検出されない、または fixture / eval は既に整備済み
```

## False-positive guards / 抑制条件

Pre-execution Gate を通過した後の **個別指摘の抑制条件** に絞る。

- 同 PR 内に別の eval 配線（`tests/fixtures/repo-wide-eval/cases.json` 編集等）がある場合、`fixtures/` ディレクトリが skill 配下になくても "missing eval" として指摘しない。
- 新規 skill の `applyTo` が `**/*` のみで真の対象パターンが空のドラフトであることが明らか（`severity: info` + `tags: [draft]` 等）なケースでは、fixture 必須化を促さない。代わりに「ドラフト解除前に eval を整備する」と案内する。
- 既存 skill の copy-and-rename だけで実質 fixture も流用される PR（同 commit で `git mv` の rename detected）では片側 fixture でも許容する。

## Output / 出力例

```yaml
findings:
  - severity: minor
    file: skills/midstream/rr-midstream-newcheck-001/SKILL.md
    line: 1
    issue: |
      新規 skill `rr-midstream-newcheck-001` が追加されましたが、
      `fixtures/` ディレクトリが見当たりません。happy-path × guard
      のペア fixture が無いと #688 の repo-wide eval で
      detectionRate / falsePositiveRate を測定できず、
      後続改修時の regression を検知できません。
    suggestion: |
      最低限以下を追加してください。
      - skills/midstream/rr-midstream-newcheck-001/fixtures/01-should-detect.md
      - skills/midstream/rr-midstream-newcheck-001/fixtures/02-should-not-detect.md
      評価配線は per-skill promptfoo (`eval/promptfoo.yaml`) か、
      `tests/fixtures/repo-wide-eval/cases.json` への追加のいずれかを選び、
      ローカルで `npm run eval:fixtures` または
      `npm run eval:repo-context` が exit 0 で通ることを確認してください。
actions:
  - type: 'verify'
    description: 'PR merge 前にローカルで `npm run eval:all` が通ることを確認する'
```

## References

- Repo-wide eval 実装: `src/lib/repo-wide-fixtures-eval.mjs` / `scripts/evaluate-review-fixtures.mjs`
- Fixture 構造の参考: `skills/midstream/security-basic/`
- Schema: `schemas/skill.schema.json`
- 改善ループ: `skills/agent-skills/river-review/references/IMPROVEMENT_LOOP.md`
