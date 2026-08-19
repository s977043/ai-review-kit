# ADR-008: `actionability` 軸を新設せず ADR-007 の `disposition` へ吸収する

## Status

Accepted—#1644 提案 2（`actionability: must-fix | nice-to-have`）について、新しい finding 軸を追加しない判断と、その代わりに満たすべき要件の置き場所を記録します。実装コードは本 ADR では書きません。

## Context

Issue #1644 は、レビュー結果に対する over-response（本 PR のスコープを超えた補完）を 2 つの提案で抑えようとしました。提案 1 は `scope: in-diff | pre-existing` であり、提案 2 は severity とは別軸の `actionability: must-fix | nice-to-have` です。

### 提案 1 は着地しており、その経路が先例になる

`main` `9942bf86` の時点で、提案 1 は内部実装から消費者表示まで到達しています。

| 段                     | 実装位置                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------ |
| 語彙と fail-safe       | [`src/lib/finding-factory.mjs`](../../src/lib/finding-factory.mjs) `:17` / `:24`     |
| 自己申告のパース       | 同 `:95`（`RE_SCOPE_LABEL`）/ `:113`（`RESERVED_FINDING_LABELS`）                    |
| 機械判定               | [`src/lib/verifier.mjs`](../../src/lib/verifier.mjs) `:215` / `:243`                 |
| 観測性                 | [`src/lib/review-engine.mjs`](../../src/lib/review-engine.mjs) `:652`                |
| ソートキー             | [`src/lib/team-lead-synthesizer.mjs`](../../src/lib/team-lead-synthesizer.mjs) `:32` |
| 公開スキーマ           | [`schemas/output.schema.json`](../../schemas/output.schema.json) `:118`              |
| JSON / YAML / HTML     | `src/cli/render.mjs` `:957` / `src/lib/output-formatters/{yaml,html}.mjs`            |
| Markdown               | `src/cli/render.mjs` `:152`                                                          |
| スキル駆動のテンプレ   | `skills/agent-skills/review-team/SKILL.md` / `commands/review-team.md`               |
| GitHub Action コメント | `runners/github-action/post-inline-comments.cjs`                                     |

つまり 1 つの表示専用軸を出し切るには、内部 3 ファイル・スキーマ・出力形式 4 種・宣言 2 種・Action 経路 1 種を同時に動かす必要がありました。この費用は本 ADR の判断材料になります。

### 提案 2 の名前には先約がある

`actionability` は [`schemas/output.schema.json`](../../schemas/output.schema.json) `:143` にすでに存在し、0 から 1 の数値スコアとして定義されています。産出元は [`src/lib/scoring/breakdown.mjs`](../../src/lib/scoring/breakdown.mjs) `:24` の `computeActionability` であり、`Fix:` または `Suggestion:` の有無から 0.0 / 0.5 / 1.0 を決めます。同 `:94` のとおり `composite` へは畳み込まれず、独立軸として出ています。

同名で文字列 enum を足すと、同じキーの型が消費者ごとに変わります。ADR-007 が `reasonCode` について記録した衝突（`gate.reasonCode` の先約）と同じ形です。

`must-fix` と `nice-to-have` の 2 語は、リポジトリ内の実装・スキーマ・スキル定義に 1 件も存在しません（`grep` による実測。唯一の一致は無関係な振り返り文書 1 行です）。

### ADR-007 はすでに同種の軸を定義している

ADR-007（[`docs/adr/007-semantic-precision-pass.md`](./007-semantic-precision-pass.md)）は 3 軸の責務境界を確定しています。

| 軸            | 意味                             | 決める主体                  |
| ------------- | -------------------------------- | --------------------------- |
| `severity`    | 問題が存在した場合の影響の大きさ | Reviewer と Verifier        |
| `confidence`  | 問題が存在する確からしさ         | Reviewer                    |
| `disposition` | レビューシステムとしてどう扱うか | 決定論の prefilter と Judge |

`disposition` の値は `blocking` / `advisory` / `suppressed` です。さらに ADR-007 の reasonCode 対応表には `valid_but_advisory`・`style_preference`・`low_actionability` が並んでおり、#1644 が例示した「完全性のための任意補完」はこの 3 コードの範囲に収まります。

Phase 1 の受け皿は実装済みです。[`src/lib/finding-factory.mjs`](../../src/lib/finding-factory.mjs) `:453` の `prefilterFindings`、`:501` の `adjudicateFindings`、`:522` の `rankFindingsForOutput` が 3 段へ分かれています。現在の `adjudicateFindings` は恒等関数であり、Judge を差し込む継ぎ目として置かれています。一方、finding フィールドとしての `disposition` は `schemas/` と `src/` のいずれにも存在しません（`grep` による実測）。

### 実データは 2026-08-19 時点でも判定材料を産んでいない

`.river/runs` の run record は 6 件で、`debug` を持つものは 0 件、`gate` を持つものも 0 件でした。findings は合計 6 件で、証跡はすべて dry-run または offline の fallback です。ADR-007 が記録した状況から変化していません。

`.river/feedback` は 43 件で、内訳は `accepted` 30・`false_positive` 9・`out_of_scope` 3・`not_actionable` 1 です。`findingFingerprint` を持つ行は 1 件のみで、run と join できません。

加えて本 ADR の執筆時に 2 つを新たに実測しました。

- `debug.scopeStats` が保存された run は 0 件である。提案 1 が観測性のために足したフィールドは、導入から今日まで 1 サンプルも残していない
- `computeActionability` を保存済みの 6 findings へ適用すると、全 6 件が 1.0 になる。決定論の近似指標は現在の母集団では 1 つも識別できていない

## Decision

### 新しい finding 軸を追加しない

Issue #1644 提案 2 が求める `actionability: must-fix | nice-to-have` は、ADR-007 の `disposition` と**同じもの**です。独立した第 4 の軸として実装しません。

`disposition` の意味は「レビューシステムとしてどう扱うか」であり、`must-fix` と `nice-to-have` が答えようとしている問いと一致します。対応は次のとおりで、提案 2 は `disposition` の真部分集合です。

| 提案 2 の値    | `disposition` の値 | 差分                                |
| -------------- | ------------------ | ----------------------------------- |
| `must-fix`     | `blocking`         | なし                                |
| `nice-to-have` | `advisory`         | なし                                |
| （対応なし）   | `suppressed`       | 提案 2 は「出さない」を表現できない |

この判断は ADR-007 の本文とも整合します。ADR-007 は責務境界の節で「`Must` / `More` / `Skip` のような第 4 の語彙を持ち込みません」と明記しており、`must-fix` / `nice-to-have` はまさにその形の語彙だからです。

直交性は成り立ちません。`blocking` かつ `nice-to-have` は「マージを止めるが直さなくてよい」であり、自己矛盾します。`advisory` かつ `must-fix` は「止めないが必ず直す」であり、強制手段を持たない `must` は `advisory` そのものと区別できません。組み合わせが意味を持たない以上、2 軸ではなく 1 軸です。

したがって #1644 提案 2 は、独立した実装対象としては閉じられます。issue そのものの開閉は本 ADR では決めません。

### 残る要件は「表示順の義務」であり、それを ADR-007 へ足す

提案 2 のうち `disposition` が覆っていない部分が 1 つだけあります。#1644 が求めたのは語彙ではなく**下位表示**であり、ADR-007 は `annotate` を「judgment を Review Artifact と表示へ出す」とだけ定義していて、並び順を規定していません。

そこで本 ADR は、ADR-007 の `annotate` に対する追加要件として次を置きます。

- `judgment.disposition` が `suppressed` の finding は `teamLeadReport.top3Findings` へ入れない
- `disposition` は `sortFindingsByPriority` の**第 4 キー**とし、`blocking` を `advisory` より前へ置く
- 第 1 キーから第 3 キー（consensusLevel → severity → scope）の順序は変更しない

第 4 キーに置く理由は 2 つあります。第一に、`disposition` を上位キーにすると「consensusLevel が severity に勝つ」という [`schemas/output.schema.json`](../../schemas/output.schema.json) の `top3Findings` が宣言する既存契約を覆すためです。第二に、`scope` より後ろへ置くのは、`scope` が diff から決定論で導かれるのに対し `disposition` は Judge の意味判断を含むからです。決定論の signal を LLM の判断より優先する方針は、`resolveFindingScope`（[`src/lib/verifier.mjs`](../../src/lib/verifier.mjs) `:243`）が machine 判定を自己申告より上に置く既存実装と同じ向きです。

第 4 キーが有効に働く根拠は [`src/lib/team-lead-synthesizer.mjs`](../../src/lib/team-lead-synthesizer.mjs) `:32` の既存コメントと同じです。上位キーの値域が狭く、実運用では多くの finding が同一バケットへ落ちるため、top3 の打ち切りはそのバケットの内側で起きます。

### 判定は Judge が行い、自己申告 enum を新設しない

`scope` には `determineScopeFromDiff`（[`src/lib/verifier.mjs`](../../src/lib/verifier.mjs) `:215`）という diff 側の正解がありました。`disposition` の `blocking` と `advisory` を分ける境界に、これと同等のものはありません。「対称なユニットテストを足すべきか」は追加行の集合からは決まらないためです。

一方で、決定論で決まる部分集合はすでに 3 つ実装されています。いずれも新しいフィールドを必要としません。

- `computeActionability`（[`src/lib/scoring/breakdown.mjs`](../../src/lib/scoring/breakdown.mjs) `:24`）が `Fix:` / `Suggestion:` の実質から 0.0 / 0.5 / 1.0 を返す
- `SUPPRESS_REASONS.STYLE_ONLY`（[`src/lib/finding-factory.mjs`](../../src/lib/finding-factory.mjs) `:34`）が minor かつ style 系 ruleId を落とす
- verifier の `suggestionActionable` が、実行可能な修正提案を欠く finding を reject する

残りは意味判断であり、ADR-007 の Judge の責務です。したがって新しい自己申告ラベルを finding 本文へ足しません。

理由は 2 つあります。第一に、`scope` では機械判定と自己申告の不一致を `debug.scopeStats.mismatch` として数えられましたが、`disposition` に照合相手となる機械判定がなく、mismatch を定義することすらできません。#1915 が記録した「印と自己申告が同じ行で矛盾する」問題は、検知不能な形で再発します。第二に、自己申告ラベルを足す費用も小さくありません。[`src/lib/finding-factory.mjs`](../../src/lib/finding-factory.mjs) `:95` のコメントが記録するとおり、無制約な `Scope:` をラベル集合へ入れると散文中の同語が直前の Evidence / Fix の取り込みを打ち切って黙って切り詰めます。新しいラベルごとに、閉じた値語彙による封じ込めをやり直すことになります。

### fail-safe は「降格させない側」へ倒す

`disposition` が欠損した場合、または Judge が結論を出せなかった場合、finding を降格させません。表示順・gate 判定ともに `disposition` 導入前と同一に扱います。

この向きを選ぶ理由は 3 つあり、いずれも既存実装に前例があります。

- 本リポジトリの fail-safe は一貫して目立つ側へ倒れる。severity 不明は major、scope 不明は `in-diff`（[`src/lib/finding-factory.mjs`](../../src/lib/finding-factory.mjs) `:24`）である
- 実在する must-fix を `nice-to-have` へ落とす見落としは、その逆のノイズより被害が大きい
- ADR-007 が「Judge 失敗時は legacy findings をそのまま Gate へ渡す」と定めており、同じ既定を表示側へも適用するだけで済む

### 語彙を増やさない

`must-fix` / `nice-to-have` の語を採りません。`nice-to-have` は `advisory` と同義であり、読者にとって区別できません。ADR-006 が `shadow` を、ADR-007 が `mode: advisory` を退けたのと同じ理由です。同一機能の中で 1 つの概念に 2 つの名前を与えません。

`actionability` という名前も採りません。0 から 1 の数値としての先約があり、同名で型を変えることは additive な変更ではありません。`actionKind` のような別名を用意する案も採りません。名前を変えても `disposition` との二重管理は解消しないためです。

Judge の reasonCode 語彙も広げません。`valid_but_advisory`・`style_preference`・`low_actionability` の 3 つで #1644 の例示は表現できます。

[`pages/reference/review-policy.md`](../../pages/reference/review-policy.md) `:81` の「段階的開示のために新しい語彙を増やしません」との関係は次のとおりです。**形式的には抵触しません。** その一文の主語は重要度ラベルであり、対象は Critical / Major / Minor / Info の 4 値です。`scope` の導入がこの制約に反しなかったのと同じ理由で、別軸の追加それ自体は禁止されていません。**一方、趣旨には抵触します。** 提案 2 の動機は下位表示という表示上の要求であり、表示のために語彙を増やすことがまさにこの一文の禁じている形だからです。本 ADR が新軸を採らない判断は、この趣旨の側と整合します。

### 段階導入の語彙を新設しない

`review.actionability.mode` のような 2 つ目の設定キーを作りません。`disposition` へ吸収する以上、段は ADR-007 の `review.adjudication.mode` に従います。値は `off` / `observe` / `annotate` / `active` の 4 値のままとし、第 5 の値も足しません。

前節の表示順の義務は `annotate` の段に属します。`active` の段は gate への接続であり、本 ADR は触れません。

### Phase 0 の受入基準を数値で置かない

`nice-to-have` の precision や over-response の減少率を Phase 0 の合格線に置きません。**現時点の保存データからは計算できないことを実測で確認したためです。** 根拠は 4 つです。

1. LLM を通った finding が 0 件であり、母数が fallback 6 件しかない
2. run record 6 件のいずれにも `debug` が無く、`scopeStats` は 1 サンプルも保存されていない
3. feedback 43 件のうち `not_actionable` は 1 件で、`findingFingerprint` を持つ行も 1 件のため、finding と join した分布を作れない
4. 決定論の近似である `computeActionability` は、保存済み 6 件すべてで 1.0 を返し、識別力が測れない

したがって Phase 0 の成果物は数値ではなく、指標定義と母集団を作るための収集条件です。収集条件は ADR-007 の「`observe` を有効化する条件」と同一であり、本 ADR は別の条件を追加しません。

代わりに、数値を伴わない機械検証可能な受入基準を 1 つ置きます。すなわち `disposition` の欠損時に表示順と gate 判定が導入前と一致することを、回帰テストで固定することです。これは保存データを必要とせず、今日から書けます。

### この軸を導入する場合に更新が必要なサーフェス

`disposition` を `annotate` まで出す実装 PR は、次をすべて動かす必要があります。提案 1 の実測経路（前掲）と同じ範囲であり、宣言と内部実装だけでは利用者へ届きません。

| #   | サーフェス                                                                                              | 種別             |
| --- | ------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | `schemas/review-artifact.schema.json`（`$defs.finding` `:350` は `additionalProperties: false` `:354`） | スキーマ         |
| 2   | `schemas/output.schema.json`（`$defs.issue` と `top3Findings` の description）                          | スキーマ         |
| 3   | `src/lib/finding-factory.mjs`（`adjudicateFindings` の実体と正規化・fail-safe）                         | 内部実装         |
| 4   | `src/lib/team-lead-synthesizer.mjs`（第 4 ソートキーと `suppressed` の除外）                            | 内部実装         |
| 5   | `src/lib/reviewer-orchestrator.mjs`（`mergeFindings` の合成規則）                                       | 内部実装         |
| 6   | `src/cli/render.mjs`（JSON の射影と Markdown の印）                                                     | 消費者表示       |
| 7   | `src/lib/output-formatters/yaml.mjs`                                                                    | 消費者表示       |
| 8   | `src/lib/output-formatters/html.mjs`                                                                    | 消費者表示       |
| 9   | `skills/agent-skills/review-team/SKILL.md`（Output Fields と対応方針）                                  | 宣言             |
| 10  | `commands/review-team.md`（**スキル駆動の主経路**。CLI 不要と明記されている `:26`）                     | 消費者表示       |
| 11  | `runners/github-action/post-inline-comments.cjs` と `npm run build:action` による dist 再構築           | 消費者表示       |
| 12  | `docs/review/output-format.md`                                                                          | 派生ドキュメント |
| 13  | `pages/reference/review-policy.md`（ja / en）                                                           | SSoT             |

10 を落とさないことが要点です。`commands/review-team.md` `:26` は「エージェントがこのスキルの手順を直接実行する（CLI 不要）」と宣言しており、CLI の描画を通らない利用者はこのテンプレートだけを読みます。9 と 10 は二重管理であり、片方だけ直すとドリフトします。

13 は「Review-doc SSoT sync」ガードの対象です。12 の記述を変えるなら、同じ PR で 13 の日本語版と英語版を更新します。

## Non-goals

- **#1644 提案 2 のための新しい finding フィールドの追加。** `actionability` の enum 化、`actionKind`、`introducedByDiff` の類を作らない。ADR-007 が定めた `judgment` の追加は本 ADR の対象外であり、この項目で禁じているものでもない。
- **既存 `actionability`（数値）の意味・値域・産出条件の変更。** `composite` から除外されている性質も維持する。
- **Judge の reasonCode 語彙の拡張。** `nice_to_have` のようなコードを足さない。
- **severity 語彙の変更。** Critical / Major / Minor / Info のままとする。
- **gate と auto-approve の意味論の変更。** `advisory` や `pre-existing` を `blockingFindings` から外さない。これは ADR-007 の `active` の範囲である。
- **Review Artifact v2 の導入。**
- **feedback taxonomy の変更。** `not_actionable` と `out_of_scope` は現状のままとする。
- **#1915 が記録した `scope` の残件の解決。** 印と自己申告の矛盾、byte-hash pin の射程、宣言の不揃いは別 issue の責務である。
- **`review.adjudication.mode` の既定値の変更。** 既定は `off` のままである。

## Consequences

- 二重管理が発生しない。提案 1 が示したとおり、1 つの表示専用軸を消費者まで届けるには 13 サーフェスが動く。同じ意味の軸を 2 本持てば費用は毎回 2 倍になり、しかも食い違ったときにどちらが正かを決める規則が要る
- #1644 の主目的である over-response の抑制は、`scope` の残件（#1915）と ADR-007 の `annotate` に依存する。本 ADR 単独では利用者の挙動を変えない
- `disposition` を `sortFindingsByPriority` へ入れる時点で、`top3Findings` の description の更新が要る。現在は「consensusLevel then severity then scope」と書かれており、第 4 キーの追加は宣言の変更を伴う
- 決定論の部分集合が既存実装に散っている状態は残る。`computeActionability`・`STYLE_ONLY`・`suggestionActionable` の 3 つは、いずれも「直す価値が薄い」に近い判断をしながら、別々の型と別々の段で表現されている。統合は ADR-007 の reasonCode 整理の側で扱う
- 提案 2 を採らないことで、「機械判定で自己申告を上書きできる」という `scope` の検証手段が `disposition` には無い、という非対称が明示的に残る。Judge の出力の検証は、mismatch 計測ではなく ADR-007 の fixture と不変条件テストに委ねる

### 再参入条件

本 ADR の「新軸を作らない」判断は、次のいずれかが成立した場合に再検討します。

1. `disposition` の `blocking` と `advisory` の境界とは独立に決まる「直す価値」の判断が、実データで観測されること。すなわち同一 `disposition` の中で利用者の対応が体系的に割れる例を、feedback と finding を join した母集団で確認できること
2. ADR-007 の `annotate` が稼働し、なお #1644 の over-response が再現すること。その場合でも、まず reasonCode の粒度で説明できるかを先に確かめる

いずれも 1 の前提として、feedback と finding が join できる状態が必要です。現状は 43 件中 1 件であり、成立していません。

## 関連

- #1644—finding の in-diff / pre-existing 区別（本 ADR の起点。提案 1 は実装済み）
- #1915—`scope` 表示に残る整合性の穴（提案 1 の残件）
- #1857—Semantic Precision Pass / Finding Adjudicator（本 ADR が吸収先とする軸）
- ADR-006—Model-Aware Review Prompt Compiler（`mode` 語彙と二義の回避の先例）
- ADR-007—Semantic Precision Pass（`severity` / `confidence` / `disposition` の責務境界）
