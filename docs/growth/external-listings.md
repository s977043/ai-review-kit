# External listing candidates

River Review の外部流入を増やすため、関連する awesome 系・curated list への掲載候補と、各リストの掲載条件・PR 方針・紹介文を整理します。

> 親エピック: [#1276](https://github.com/s977043/river-review/issues/1276) / 追跡 Issue: [#1283](https://github.com/s977043/river-review/issues/1283) / 関連: [#1247](https://github.com/s977043/river-review/issues/1247)

掲載申請では River Review を一般的な AI review bot ではなく、`Review Judgment as Code` / `team-owned audit layer` として説明します。誇張表現・自動承認/自動マージの強調は避けます。

## 紹介文（共通コピー）

英語（1 行・非宣伝的トーン）:

```text
River Review — Review Judgment as Code for AI-assisted development. Lets teams codify review standards as repo-owned skills and run them across plans, diffs, tests, JUnit, and prior review artifacts.
```

短縮版（リスト用 1 行説明）:

```text
Codify team review judgment as repo-owned skills; run them as GitHub Action / plan-diff-test gates.
```

## 候補リストと掲載条件

各リストの条件は申請時に最新の CONTRIBUTING / PR テンプレートで再確認すること（掲載ルールは変わりうる）。

### 優先度: 高

| リスト                | repo                                                                                                | 掲載方法                                                                                                      | 主な条件                                                                                                                                                                                                        | River Review の適合                                                                                                                                  |
| --------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| awesome-codex-plugins | [hashgraph-online/awesome-codex-plugins](https://github.com/hashgraph-online/awesome-codex-plugins) | スキャナCIを自リポに追加 → ローカル実行 → fork して README にアルファベット順 1 行追加（PR 説明にスコア記載） | スキャナスコア 80/130 以上・critical/high なし、`.codex-plugin/plugin.json`（name/version/description/repository/license/composerIcon）、512×512 アイコン、SECURITY.md / LICENSE / README.md、1 PR 1 プラグイン | Good — 既に Codex プラグインと `.codex-plugin/plugin.json` を同梱。[#1247](https://github.com/s977043/river-review/issues/1247) で外部からも提案済み |
| awesome-code-review   | [joho/awesome-code-review](https://github.com/joho/awesome-code-review)                             | `Tools` セクションへ PR                                                                                       | アルファベット順、説明は**非宣伝的**で簡潔・末尾に句読点、新カテゴリは 3 件以上、CoC 同意                                                                                                                       | Good — コードレビューツールそのもの。GitHub/Gerrit 等と並ぶ。説明は中立トーン必須                                                                    |
| awesome-actions       | [sdras/awesome-actions](https://github.com/sdras/awesome-actions)                                   | 該当カテゴリ末尾へ PR                                                                                         | 意味のある PR タイトル（"Update readme" は却下）、1 PR 1 提案、1 行説明（3 行に折り返さない）、Title Case、重複不可                                                                                             | Good — GitHub Action として配布しており直球で適合                                                                                                    |

### 優先度: 中

| リスト              | repo                                                                                  | 掲載方法                                                     | 主な条件                                                                                                                                         | River Review の適合                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| awesome-ai-devtools | [jamesmurdza/awesome-ai-devtools](https://github.com/jamesmurdza/awesome-ai-devtools) | `PR & Code Review Bots` カテゴリへ PR（PR テンプレート準拠） | フォーマット詳細は PR テンプレートを要確認                                                                                                       | Good — CodeRabbit / Qodo / Greptile と同カテゴリ。`awesome-developer-tools` には単一の正本が存在しないため、本リストを代替候補とする                             |
| awesome-ai-agents   | [e2b-dev/awesome-ai-agents](https://github.com/e2b-dev/awesome-ai-agents)             | README へ PR（CONTRIBUTING なし、ルールは README 内）        | 「**自律 AI エージェント**で動く企業・プロジェクト」のみ。アルファベット順・正カテゴリ。フレームワーク/SDK は姉妹リスト `awesome-ai-sdks` へ誘導 | Marginal — River Review はレビューフレームワーク/Action でありエージェント製品ではない。掲載は「agentic reviewer」として慎重に位置づけた場合のみ。優先度は下げる |

### 対象外（適合せず）

| リスト                          | repo                                                                              | 理由                                                                                                                                            |
| ------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| awesome-llm-apps                | [Shubhamsaboo/awesome-llm-apps](https://github.com/Shubhamsaboo/awesome-llm-apps) | リンク集ではなく、実行可能なオリジナルアプリの monorepo。単なる掲載は不可で、専用テンプレアプリの実装が必要なため River Review の性質と合わない |
| awesome-developer-tools（汎称） | 単一の正本なし                                                                    | 同名の競合リストが複数存在し正本を特定できない。代わりに `awesome-ai-devtools` を狙う                                                           |

## 申請優先順位

1. **awesome-codex-plugins**—同梱プラグインと manifest が揃っており、外部提案（#1247）もある。最短で成立する見込み
2. **awesome-actions**—GitHub Action として直球で適合
3. **awesome-code-review**—ドメイン一致。非宣伝的な説明文を用意
4. **awesome-ai-devtools**—PR & Code Review Bots カテゴリ。PR テンプレートを確認のうえ申請
5. **awesome-ai-agents**—位置づけを慎重に検討（優先度低）

## 注意点

- 各リストの掲載ルールは申請時点の CONTRIBUTING / PR テンプレートで再確認する。
- 説明文は非宣伝的トーンを保ち、OpenSSF / CI / CodeQL などの trust signal は事実ベースで触れる。
- npm 公開を前提にした説明にはしない（[プロジェクト方針](../../README.md#はじめる)）。
