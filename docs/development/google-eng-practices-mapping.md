# `google/eng-practices` Mapping

[`google/eng-practices`](https://google.github.io/eng-practices/) は Google が社内で長年運用してきたコードレビュー文化を公開したドキュメント集です。River Review は Google 以外の組織でも利用される汎用 OSS なので **そのままコピーするのではなく、既存の `severity` 語彙 / skill registry / review policy にどう翻訳されるか** を整理します。

このページは River Review 利用者と skill 作者向けで、Google の用語が出てきたときに River Review のどの仕組みで等価のことが扱えるかを引きやすくするのが目的です。

## 取り込み方針（要約）

- **思想**: 完璧主義禁止 / "Improve the overall code health" は `review-policy-standard` skill (upstream / midstream / downstream) の prompt に取り込み済み。
- **語彙**: must / should / nit / optional は River Review の `severity: critical | major | minor | info` に対応表で吸収（新 taxonomy は導入しない）。
- **レビュー観点の優先順** (Design > Functionality > Complexity > Tests > Naming) は River Review の phase (upstream / midstream / downstream) + 既存 skill カタログにマップ可能。
- **PR size** / **review speed SLA** / **Readability approval 制度** などの組織運用面は skill では扱わず、CI metric / docs / org policy 側へ送る。

## Comment hierarchy ↔ `severity` ladder

| `google/eng-practices` | River Review `severity`         | 意味                        |
| ---------------------- | ------------------------------- | --------------------------- |
| must                   | `critical` あるいは強い `major` | merge 前に対処すべき実害    |
| should                 | `major`                         | 残すと debt になる強い推奨  |
| nit                    | `minor`                         | polish / 好み寄り、見送り可 |
| optional / FYI         | `info`                          | 情報共有のみ、対応不要      |

詳細な `severity` の付け方は [`skill-severity-rubric.md`](./skill-severity-rubric.md) を参照してください。**この表は外部語彙との対応であって、River Review の rubric 本体ではありません**。

## レビュー観点優先順 ↔ phase / skill カテゴリ

`google/eng-practices` の "What to look for in a code review" は Design > Functionality > Complexity > Tests > Naming の優先順を提示しています。River Review ではこれを **phase + 既存 skill** に分解します。

| Google 観点   | River Review 上の主担当                                                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Design        | `phase: upstream` の skill（`architecture-*`, `api-*`, `plangate-*` ほか）。`review-policy-standard` の upstream 版が「設計フェーズの重点」を prompt で明示。 |
| Functionality | `phase: midstream` の `review-policy-standard` が「壊れる/漏れる/回復できない」順を prompt で固定。                                                           |
| Complexity    | `phase: midstream` の中で `logic-torturing` / `type-driven-design` などが cognitive load / clever code を扱う。                                               |
| Tests         | `phase: downstream` の skill 群（`coverage-gap`, `flaky-test`, `test-existence` ほか）と `code-*`。                                                           |
| Naming        | 各 phase の policy skill が prompt で軽量な命名ガイドを持ち、`normalization-consistency` が一貫性視点を補完。                                                 |

## 採用しない（取り込まない）要素

`google/eng-practices` のうち、River Review の汎用 skill に直接持ち込むと scope が崩れるものは以下です。これらは別レイヤで扱います。

| 要素                                                                      | 理由                                               | 該当レイヤ                                                   |
| ------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------ |
| Speed of Code Reviews（SLA）                                              | diff から判断不能、組織 metric の領域              | DORA metrics / CI dashboard / 別 epic                        |
| Reviewer role（Gatekeeper + Mentor）                                      | 役割定義であって per-PR 評価ではない               | onboarding doc / org culture                                 |
| Readability approval 制度                                                 | Google 固有の認定制度。汎用化が困難                | スコープ外（必要な組織は独自 skill / policy で扱う）         |
| Comment hierarchy を新 taxonomy として導入                                | 既存 `severity` ladder と競合し、運用が二重化する  | 上の対応表で吸収するのみ                                     |
| Design > Functionality > Complexity > Tests > Naming 絶対順の機械ルール化 | 個別 PR の重みは domain 依存。固定順は誤指摘を生む | 参考順位として skill prompt に存在、ただし強制ルールにしない |

## PR size 警告（将来エピック）

`google/eng-practices` の "Small CLs" 原則は River Review でも価値が高いですが、これは **per-PR の LLM finding ではなく diff metric** として扱うべきです。

現状 `runners/core/review-runner.mjs` の `buildExecutionPlan` は `extractDiffMeta` 経由で `reviewMode: tiny | medium | large` を返しています。将来この閾値判定を拡張し、CI annotation / GitHub Action soft warning 経由で PR size を adopter に提示できます。実装は別エピックで扱い、本 mapping doc では「思想として吸収済み」とだけ位置付けます。

## 参考リンク

- [`google/eng-practices` Code Review Standard](https://google.github.io/eng-practices/review/reviewer/standard.html)
- [`google/eng-practices` What to look for](https://google.github.io/eng-practices/review/reviewer/looking-for.html)
- [`google/eng-practices` Speed of Code Reviews](https://google.github.io/eng-practices/review/reviewer/speed.html)
- [`google/eng-practices` Small CLs](https://google.github.io/eng-practices/review/developer/small-cls.html)
- [`skill-severity-rubric.md`](./skill-severity-rubric.md)—River Review の `severity` 定義（本対応表の親ドキュメント）
- [`execution-context-contract.md`](./execution-context-contract.md)—`runReviewPlan` → `generateReview` の context contract
