# RA-1 Runtime Adapter 棚卸し（ADR-009 D7-4）

ADR-009 [`009-plugin-first-product-and-runtime-contract.md`](../adr/009-plugin-first-product-and-runtime-contract.md) の D7-4 が未処理として残した `.claude/**` の棚卸し結果です。#2027 で RA-1 の検査を実装した際に、検査対象の全ファイルを 1 件ずつ判定しました。

判定は `scripts/validate-plugin-manifest.mjs` の `detectReviewJudgmentDefinitions` と `checkReviewJudgmentDuplication` の実行結果です。人手の読み下しではありません。再実行は `npm run plugin:validate` で行えます。

## 測定条件

| 項目             | 値                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------ |
| 測定日           | 2026-09-04                                                                           |
| 対象の列挙方法   | `git ls-files -z -- .claude/** .codex/** .claude-plugin/*.json .codex-plugin/*.json` |
| 対象ファイル総数 | 46 件                                                                                |
| うち適合         | 41 件                                                                                |
| うち違反         | 5 件（検出 10 件）                                                                   |
| 検査の適用段階   | observe（`RA1_ENFORCEMENT = 'observe'`。違反は報告のみで CI を落としません）         |

`.claude/**/*.md` に限れば 37 件で、ADR-009 D3-3 が 2026-09-03 に記録した件数と一致します。総数 46 件との差 9 件の内訳は、`.claude/settings.json` 1 件、`.claude/hooks/*.sh` 3 件、`.codex/**` 2 件、manifest 3 件です。

`find .claude -name '*.md'` は agent worktree のフルコピーを拾うため使いません。ADR-009 D3-3 項番 1 の指定どおり `git ls-files` を基準にしています。

## 違反 5 件と処置

いずれも検出規則は 2 種類のみで、`completion-condition` と `finding-evidence-requirement` の検出は 0 件でした。

| ファイル                                    | 検出                                        | 除外条件の充足                  | 処置                                                    |
| ------------------------------------------- | ------------------------------------------- | ------------------------------- | ------------------------------------------------------- |
| `.claude/rules/review-core.md`              | `severity-vocabulary-map` `:21`             | 参照あり・逐語一致なし → 不成立 | 出典へ `src/lib/finding-factory.mjs` を追加する（提案） |
| `.claude/commands/merge-check.md`           | `gate-decision-condition` `:156` `:162`     | SSoT 参照なし → 不成立          | active 化前に判定範囲を確定する（未決）                 |
| `.claude/commands/preflight.md`             | `gate-decision-condition` `:72` `:83` `:97` | SSoT 参照なし → 不成立          | 同上                                                    |
| `.claude/commands/register-plugin-asset.md` | `gate-decision-condition` `:66` `:72`       | 参照あり・逐語一致なし → 不成立 | 同上                                                    |
| `.claude/commands/verify-agent-report.md`   | `gate-decision-condition` `:79` `:85`       | SSoT 参照なし → 不成立          | 同上                                                    |

### `.claude/rules/review-core.md`

ADR-009 D7-2 が予告したケースそのものです。同ファイル `:21`〜`:23` は severity の内部語彙と出力スキーマの対応表を持ちますが、宣言する SSoT 3 本に内部語彙が逐語で現れません。2026-09-04 の実測でも `grep -c blocker` は `pages/reference/review-policy.md` `docs/review/output-format.md` `docs/review/viewpoints.md` のいずれも 0 を返します。

一方で ADR-009 D4 `:122` は「severity 語彙の正本は `src/lib/**` にある」と明記しており、`src/lib/**` は D3-3 の除外 SSoT 一覧に含まれます。`src/lib/finding-factory.mjs` には `blocker` `warning` `nit` `critical` `major` `minor` の 6 語がすべて逐語で存在します。

したがって出典の追記 1 行で除外条件が成立します。検査コードに手を入れず違反が消えることは、実ファイルを編集しないシミュレーションで確認済みです。

`.claude/**` はエージェント設定領域でユーザー承認を要するため、#2027 では編集せず提案に留めます。

### `.claude/commands/**` 4 件

4 件はいずれも「判定」節で verdict を定義し、直後に `条件:` 行を置く同じ形をしています。ADR-009 D7-4 は `merge-check.md` の `MERGE_OK` / `BLOCKED` を「D3 が禁じる gate / decision の判定条件」に当たると記録しました。同じ読み方を適用すると、残る 3 件も同じ理由で違反になります。

ただし、この 4 件が定義する verdict はリポジトリの作業手順に対する判定です。River Review 製品の gate 語彙（`src/lib/gate-decision.mjs` の `GATE_DECISIONS`、すなわち `GO` `GO_WITH_OBSERVATION` `NO_GO` `ESCALATE`）とは名前空間が異なります。検出はしていますが、これを Review Judgment の正本と呼ぶべきかは ADR-009 の記述だけでは決まりません。observe 段階で確定させるべき論点として本節に記録し、active 化の前提とします。

## 未決の論点（active 化の前提）

1. `docs/governance.md` を D3-3 の除外 SSoT 一覧へ加えるか。#2027 の推奨は「加えない」である。2026-09-04 実測で `grep -c MERGE_OK docs/governance.md` は 0 を返すため、加えても `merge-check.md` の逐語一致は成立しない。また ADR-009 D4 の runtime-independent 資産一覧に `docs/governance.md` は含まれない
2. リポジトリ作業手順の verdict を RA-1 の対象に含めるか。含めないなら `gate-decision-condition` の語彙を `GATE_DECISIONS` へ絞る。含めるなら 4 件の verdict 定義を SSoT ドキュメントへ移す
3. 上記 2 点が決まるまで `RA1_ENFORCEMENT` は `observe` のままとする

## 検査の適用段階

`scripts/validate-plugin-manifest.mjs` の `RA1_ENFORCEMENT` が段階を持ちます。値は `off` / `observe` / `active` の 3 つで、現在は `observe` です。

| 段階      | 挙動                                                       |
| --------- | ---------------------------------------------------------- |
| `off`     | RA-1 を実行しない                                          |
| `observe` | 違反を警告として出力する。終了コードは変えない             |
| `active`  | 違反をエラーとして扱う。`npm run plugin:validate` が落ちる |

`active` への切り替えは別 PR で行います。前提は「未決の論点」の解消と、違反 5 件が 0 件へ減ることです。

## 付録: 適合 41 件の一覧

禁止パターンの検出が 0 件のため、除外条件の判定に進むまでもなく適合です。SSoT 参照の有無は参考情報として併記します。

| ファイル                                                                           | 判定 | 根拠                                         |
| ---------------------------------------------------------------------------------- | ---- | -------------------------------------------- |
| `.claude-plugin/marketplace.json`                                                  | 適合 | 禁止パターン検出 0 件。SSoT 参照なし         |
| `.claude-plugin/plugin.json`                                                       | 適合 | 禁止パターン検出 0 件。SSoT 参照あり（1 本） |
| `.claude/agents/README.md`                                                         | 適合 | 禁止パターン検出 0 件。SSoT 参照なし         |
| `.claude/commands/README.md`                                                       | 適合 | 禁止パターン検出 0 件。SSoT 参照なし         |
| `.claude/commands/plan-merge-order.md`                                             | 適合 | 禁止パターン検出 0 件。SSoT 参照あり（3 本） |
| `.claude/commands/propose-issue.md`                                                | 適合 | 禁止パターン検出 0 件。SSoT 参照なし         |
| `.claude/commands/release-kick.md`                                                 | 適合 | 禁止パターン検出 0 件。SSoT 参照なし         |
| `.claude/hooks/README.md`                                                          | 適合 | 禁止パターン検出 0 件。SSoT 参照なし         |
| `.claude/hooks/format.sh`                                                          | 適合 | 禁止パターン検出 0 件。SSoT 参照なし         |
| `.claude/hooks/gh-account-guard.sh`                                                | 適合 | 禁止パターン検出 0 件。SSoT 参照なし         |
| `.claude/hooks/no-force-push.sh`                                                   | 適合 | 禁止パターン検出 0 件。SSoT 参照なし         |
| `.claude/rules/README.md`                                                          | 適合 | 禁止パターン検出 0 件。SSoT 参照あり（2 本） |
| `.claude/settings.json`                                                            | 適合 | 禁止パターン検出 0 件。SSoT 参照なし         |
| `.claude/skills/README.md`                                                         | 適合 | 禁止パターン検出 0 件。SSoT 参照なし         |
| `.claude/skills/ask-codex/SKILL.md`                                                | 適合 | 禁止パターン検出 0 件。SSoT 参照なし         |
| `.claude/skills/river-review-discipline/SKILL.md`                                  | 適合 | 禁止パターン検出 0 件。SSoT 参照あり（6 本） |
| `.claude/skills/river-review-discipline/anti-patterns.md`                          | 適合 | 禁止パターン検出 0 件。SSoT 参照なし         |
| `.claude/skills/river-review-discipline/review-memory.md`                          | 適合 | 禁止パターン検出 0 件。SSoT 参照なし         |
| `.claude/skills/river-review-discipline/river-review-loop.md`                      | 適合 | 禁止パターン検出 0 件。SSoT 参照なし         |
| `.claude/skills/river-review-discipline/templates/design-review-template.md`       | 適合 | 禁止パターン検出 0 件。SSoT 参照あり（2 本） |
| `.claude/skills/river-review-discipline/templates/diff-review-template.md`         | 適合 | 禁止パターン検出 0 件。SSoT 参照あり（1 本） |
| `.claude/skills/river-review-discipline/templates/report-review-template.md`       | 適合 | 禁止パターン検出 0 件。SSoT 参照なし         |
| `.claude/skills/river-review-discipline/templates/requirements-review-template.md` | 適合 | 禁止パターン検出 0 件。SSoT 参照あり（1 本） |
| `.claude/skills/river-review-discipline/templates/verification-review-template.md` | 適合 | 禁止パターン検出 0 件。SSoT 参照なし         |
| `.claude/skills/river-review-discipline/usage-prompts.md`                          | 適合 | 禁止パターン検出 0 件。SSoT 参照なし         |
| `.claude/skills/skill-creator/SKILL.md`                                            | 適合 | 禁止パターン検出 0 件。SSoT 参照なし         |
| `.claude/skills/skill-creator/assets/basic-skill-template.md`                      | 適合 | 禁止パターン検出 0 件。SSoT 参照なし         |
| `.claude/skills/skill-creator/assets/eval-rubric-template.md`                      | 適合 | 禁止パターン検出 0 件。SSoT 参照なし         |
| `.claude/skills/skill-creator/references/design-principles.md`                     | 適合 | 禁止パターン検出 0 件。SSoT 参照なし         |
| `.claude/skills/skill-creator/references/review-default.md`                        | 適合 | 禁止パターン検出 0 件。SSoT 参照なし         |
| `.claude/skills/skill-ops-planner/SKILL.md`                                        | 適合 | 禁止パターン検出 0 件。SSoT 参照なし         |
| `.claude/skills/skill-ops-planner/assets/skill-roadmap-template.md`                | 適合 | 禁止パターン検出 0 件。SSoT 参照なし         |
| `.claude/skills/skill-ops-planner/references/portfolio-policy.md`                  | 適合 | 禁止パターン検出 0 件。SSoT 参照なし         |
| `.claude/skills/skill-ops-planner/references/review-default.md`                    | 適合 | 禁止パターン検出 0 件。SSoT 参照なし         |
| `.claude/skills/skill-optimizer/SKILL.md`                                          | 適合 | 禁止パターン検出 0 件。SSoT 参照なし         |
| `.claude/skills/skill-optimizer/assets/eval-rubric-template.md`                    | 適合 | 禁止パターン検出 0 件。SSoT 参照なし         |
| `.claude/skills/skill-optimizer/references/optimization-playbook.md`               | 適合 | 禁止パターン検出 0 件。SSoT 参照なし         |
| `.claude/skills/skill-optimizer/references/review-default.md`                      | 適合 | 禁止パターン検出 0 件。SSoT 参照なし         |
| `.codex-plugin/plugin.json`                                                        | 適合 | 禁止パターン検出 0 件。SSoT 参照あり（1 本） |
| `.codex/AGENTS.md`                                                                 | 適合 | 禁止パターン検出 0 件。SSoT 参照あり（1 本） |
| `.codex/config.toml`                                                               | 適合 | 禁止パターン検出 0 件。SSoT 参照なし         |
