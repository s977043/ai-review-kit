# RA-1 Runtime Adapter 棚卸し（ADR-009 D7-4）

ADR-009 [`009-plugin-first-product-and-runtime-contract.md`](../adr/009-plugin-first-product-and-runtime-contract.md) の D7-4 が未処理として残した `.claude/**` の棚卸し結果です。#2027 で RA-1 の検査を実装した際に、検査対象の全ファイルを 1 件ずつ判定しました。

判定は `scripts/validate-plugin-manifest.mjs` の `detectReviewJudgmentDefinitions` と `checkReviewJudgmentDuplication` の実行結果です。人手の読み下しではありません。再実行は `npm run plugin:validate` で行えます。

## 測定条件

| 項目             | 値                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------ |
| 測定日           | 2026-09-04                                                                           |
| 対象の列挙方法   | `git ls-files -z -- .claude/** .codex/** .claude-plugin/*.json .codex-plugin/*.json` |
| 対象ファイル総数 | 46 件                                                                                |
| うち適合         | 45 件                                                                                |
| うち違反         | 1 件（検出 1 件）                                                                    |
| 検査の適用段階   | observe（`RA1_ENFORCEMENT = 'observe'`。違反は報告のみで CI を落としません）         |

`.claude/**/*.md` に限れば 37 件で、ADR-009 D3-3 が 2026-09-03 に記録した件数と一致します。総数 46 件との差 9 件の内訳は、`.claude/settings.json` 1 件、`.claude/hooks/*.sh` 3 件、`.codex/**` 2 件、manifest 3 件です。

`find .claude -name '*.md'` は agent worktree のフルコピーを拾うため使いません。ADR-009 D3-3 項番 1 の指定どおり `git ls-files` を基準にしています。

## 検出範囲の宣言

**この検査は「Review Judgment の複製をすべて検出する」ものではありません。** 検出できるのは下表の記法に限ります。範囲外の記法は、内容が同じでも検出されません。範囲を明示するのは、検査の緑を「複製が無いことの証明」と読み違えないためです。

| 分類                           | 検出できる記法                                                                                                                                                                        | 検出できない記法                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `severity-vocabulary-map`      | Markdown 表の隣接 2 セルが内部語彙と出力語彙の対で並ぶ形。列数は 3 列以上でもよい。セル値の `` ` `` `*` `~` と全角パイプ `｜` は正規化する                                            | 散文中の対応記述、日本語語彙（ブロッカー 等）、語中に空白を挟む表記 |
| `gate-decision-condition`      | verdict が見出し・太字ラベル・箇条書き項目・表の第 1 セルの**主語位置**にあり、同じ節または直後 8 行以内に `条件:` `成立要件:` などの行がある形。表形式は行内の別セルを条件文とみなす | 散文だけで条件を述べる形、verdict を主語位置に置かない形            |
| `completion-condition`         | 完了条件・完了判定・completion criteria を含む見出しと `条件:` 行の組                                                                                                                 | 上記語を使わない完了条件の記述                                      |
| `finding-evidence-requirement` | finding / 指摘 と 証跡 / evidence と 必須 / MUST / required の 3 語が同一行に揃う形                                                                                                   | 3 語が複数行に散る形                                                |

verdict とみなすトークンは `src/lib/gate-decision.mjs` `:68` の `GATE_DECISIONS`、すなわち `GO` `GO_WITH_OBSERVATION` `NO_GO` `ESCALATE` の 4 語に限ります。検出器はこれを import しており、再宣言していません。範囲をこの 4 語へ絞った理由は「決定 1」節に書きます。

トークン形状だけで verdict を判定する方式は採りません。4 文字以上の SCREAMING_CASE という形状規則は `CLAUDE` `AGENTS` `JSON` `HTTP` の見出しを gate verdict と誤判定します。語彙を製品 gate へ絞る変更が、同時にこの誤検出の対策にもなっています。

## 決定 1—RA-1 の判定範囲は製品 gate 語彙に限る

`.claude/commands/**` の 4 ファイルは `MERGE_OK` `SAFE` `PASS` `REGISTERED` などの verdict を「判定」節で定義し、直後に `条件:` 行を置いています。これらを RA-1 の対象に含めるか否かが #2027 の最大の論点でした。

**含めません。** これらの verdict が判定するのはリポジトリの作業手順であり、レビューではありません。River Review 製品の gate 語彙は `src/lib/gate-decision.mjs` `:68` の `GATE_DECISIONS`（`GO` `GO_WITH_OBSERVATION` `NO_GO` `ESCALATE`）であって、両者は名前空間が異なります。ADR-009 D3 が守る「gate / decision の意味」は前者を指しません。

この決定により、`gate-decision-condition` 規則の語彙は `GATE_DECISIONS` の 4 語に限定されました。検出は 10 件から 1 件へ減っています。

**ADR-009 D7-4 `:147` は `merge-check.md` `:156` `:162` を D3 違反として数えており、本決定と食い違います。ADR 本文の訂正は別 PR が必要です。**（#2027 の Non-goals が ADR の決定変更を除いているため、本 PR では訂正しません。）

## 決定 2—`.claude/rules/review-core.md` は出典を足して残す

ADR-009 D7-2 が予告したケースです。同ファイル `:21`〜`:23` は severity の内部語彙と出力スキーマの対応表を持ちますが、宣言する SSoT 3 本に内部語彙が逐語で現れません。2026-09-04 の実測でも `grep -c blocker` は `pages/reference/review-policy.md` `docs/review/output-format.md` `docs/review/viewpoints.md` のいずれも 0 を返します。

一方で ADR-009 D4 `:122` は「severity 語彙の正本は `src/lib/**` にある」と明記しており、`src/lib/**` は D3-3 の除外 SSoT 一覧に含まれます。`src/lib/finding-factory.mjs` には `blocker` `warning` `nit` `critical` `major` `minor` の 6 語がすべて逐語で存在します。

したがって出典を 1 行足せば除外条件が成立します。追加する行は次のとおりです。

```text
- severity 内部語彙と出力スキーマ対応の実体: `src/lib/finding-factory.mjs`
```

この 1 行で violations が `[]` になることは、実ファイルを編集しないシミュレーションで確認済みです。**ただし `.claude/**` はエージェント設定領域にあたり、権限機構が編集を拒否しました。** 適用は権限を持つ主体へ委ねます。適用されるまで RA-1 の違反は 1 件残ります。

## 違反の disposition

| ファイル                                    | 検出（決定 1 適用前）                       | 現在の扱い                 | 処置                                                      |
| ------------------------------------------- | ------------------------------------------- | -------------------------- | --------------------------------------------------------- |
| `.claude/rules/review-core.md`              | `severity-vocabulary-map` `:21`             | 違反として検出中（1 件）   | 決定 2。出典 1 行の追加で解消する。適用は権限保持者が行う |
| `.claude/commands/merge-check.md`           | `gate-decision-condition` `:156` `:162`     | 対象外（作業手順 verdict） | 決定 1。検出器の語彙を `GATE_DECISIONS` へ絞り解消済み    |
| `.claude/commands/preflight.md`             | `gate-decision-condition` `:72` `:83` `:97` | 対象外（作業手順 verdict） | 同上                                                      |
| `.claude/commands/register-plugin-asset.md` | `gate-decision-condition` `:66` `:72`       | 対象外（作業手順 verdict） | 同上                                                      |
| `.claude/commands/verify-agent-report.md`   | `gate-decision-condition` `:79` `:85`       | 対象外（作業手順 verdict） | 同上                                                      |

`completion-condition` と `finding-evidence-requirement` の検出は 46 件を通じて 0 件でした。誤検出も、**本節が測定した 46 件の範囲では** 0 件です。範囲外のファイルについては測っていません。

なお `docs/governance.md` を D3-3 の除外 SSoT 一覧へ加える案は採りません。2026-09-04 実測で `grep -c MERGE_OK docs/governance.md` が 0 を返すため逐語一致が成立せず、ADR-009 D4 `:115` の runtime-independent 資産一覧にも含まれないためです。決定 1 により `merge-check.md` 自体が対象外となり、この論点は解消しました。

## 検査の適用段階

`scripts/validate-plugin-manifest.mjs` の `RA1_ENFORCEMENT` が段階を持ちます。値は `off` / `observe` / `active` の 3 つで、現在は `observe` です。

| 段階      | 挙動                                                       |
| --------- | ---------------------------------------------------------- |
| `off`     | RA-1 を実行しない                                          |
| `observe` | 違反を警告として出力する。終了コードは変えない             |
| `active`  | 違反をエラーとして扱う。`npm run plugin:validate` が落ちる |

決定 1 と決定 2 で 5 件すべての disposition が決まったため、`active` を阻む論点はもう残っていません。それでも `observe` を維持しているのは、決定 2 の 1 行がまだ適用できていないからです。`active` にすると `npm run plugin:validate` が `.claude/rules/review-core.md` で落ち、無関係な PR がすべて止まります。

`active` への切り替え条件は 1 つだけです。決定 2 の 1 行が `.claude/rules/review-core.md` へ入り、`npm run plugin:validate` の RA-1 observation が 0 件になること。満たされた時点で `RA1_ENFORCEMENT` を `'active'` にする 1 行の PR を出します。

## 付録: 適合 45 件の一覧

禁止パターンの検出が 0 件のため、除外条件の判定に進むまでもなく適合です。SSoT 参照の有無は参考情報として併記します。

| ファイル                                                                           | 判定 | 根拠                                         |
| ---------------------------------------------------------------------------------- | ---- | -------------------------------------------- |
| `.claude-plugin/marketplace.json`                                                  | 適合 | 禁止パターン検出 0 件。SSoT 参照なし         |
| `.claude-plugin/plugin.json`                                                       | 適合 | 禁止パターン検出 0 件。SSoT 参照あり（1 本） |
| `.claude/agents/README.md`                                                         | 適合 | 禁止パターン検出 0 件。SSoT 参照なし         |
| `.claude/commands/README.md`                                                       | 適合 | 禁止パターン検出 0 件。SSoT 参照なし         |
| `.claude/commands/merge-check.md`                                                  | 適合 | 禁止パターン検出 0 件。SSoT 参照なし         |
| `.claude/commands/plan-merge-order.md`                                             | 適合 | 禁止パターン検出 0 件。SSoT 参照あり（3 本） |
| `.claude/commands/preflight.md`                                                    | 適合 | 禁止パターン検出 0 件。SSoT 参照なし         |
| `.claude/commands/propose-issue.md`                                                | 適合 | 禁止パターン検出 0 件。SSoT 参照なし         |
| `.claude/commands/register-plugin-asset.md`                                        | 適合 | 禁止パターン検出 0 件。SSoT 参照あり（1 本） |
| `.claude/commands/release-kick.md`                                                 | 適合 | 禁止パターン検出 0 件。SSoT 参照なし         |
| `.claude/commands/verify-agent-report.md`                                          | 適合 | 禁止パターン検出 0 件。SSoT 参照なし         |
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
