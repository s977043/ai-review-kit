# External listing candidates

River Review の外部流入を増やすため、関連する awesome 系・curated list への掲載候補と、各リストの掲載条件・PR 方針・紹介文を整理します。

> 親エピック: [#1276](https://github.com/s977043/river-review/issues/1276) / 追跡 Issue: [#1283](https://github.com/s977043/river-review/issues/1283)

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

| リスト                | repo                                                                                                | 掲載方法                                                                                                      | 主な条件                                                                                                                                                                                                        | River Review の適合                                                                                              |
| --------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| awesome-codex-plugins | [hashgraph-online/awesome-codex-plugins](https://github.com/hashgraph-online/awesome-codex-plugins) | スキャナCIを自リポに追加 → ローカル実行 → fork して README にアルファベット順 1 行追加（PR 説明にスコア記載） | スキャナスコア 80/130 以上・critical/high なし、`.codex-plugin/plugin.json`（name/version/description/repository/license/composerIcon）、512×512 アイコン、SECURITY.md / LICENSE / README.md、1 PR 1 プラグイン | **掲載済み（live）**—upstream の `main` に `plugins/s977043/river-review` として反映済み。外部からの提案もあった |
| awesome-code-review   | [joho/awesome-code-review](https://github.com/joho/awesome-code-review)                             | `Tools` セクションへ PR                                                                                       | アルファベット順、説明は**非宣伝的**で簡潔・末尾に句読点、新カテゴリは 3 件以上、CoC 同意                                                                                                                       | Good — コードレビューツールそのもの。GitHub/Gerrit 等と並ぶ。説明は中立トーン必須                                |
| awesome-actions       | [sdras/awesome-actions](https://github.com/sdras/awesome-actions)                                   | 該当カテゴリ末尾へ PR                                                                                         | 意味のある PR タイトル（"Update readme" は却下）、1 PR 1 提案、1 行説明（3 行に折り返さない）、Title Case、重複不可                                                                                             | Good — GitHub Action として配布しており直球で適合                                                                |

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

1. **awesome-codex-plugins**—✅ **掲載済み（live on `main`）**。同梱プラグインと manifest が揃っており、外部からの提案もあった
2. **awesome-actions**—GitHub Action として直球で適合。⏳ 提出済み・マージ待ち（#829）
3. **awesome-code-review**—ドメイン一致。非宣伝的な説明文を用意。⏳ 提出済み・マージ待ち（#131）
4. **awesome-ai-devtools**—PR & Code Review Bots カテゴリ。⏳ 提出済み・マージ待ち（#697）
5. **awesome-ai-agents**—位置づけを慎重に検討（優先度低）。未提出

> 提出済み PR の一覧と状態は下記「提出状況（トラッキング）」を参照。

## 提出状況（トラッキング）

各リストへの提出 PR と、その時点の状態。状態は変わりうるため、確認時は各 PR / upstream の `main` を直接参照すること（最終確認: 2026-07-04）。

| リスト                | 提出 PR                                                                    | 状態                          | 備考                                                                                      |
| --------------------- | -------------------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------- |
| awesome-codex-plugins | [#229](https://github.com/hashgraph-online/awesome-codex-plugins/pull/229) | ✅ 掲載済み（live on `main`） | PR は GitHub 上 CLOSED だが maintainer が別経路で `main` へ反映。掲載成立                 |
| awesome-actions       | [#829](https://github.com/sdras/awesome-actions/pull/829)                  | ⏳ Open・マージ待ち           | 2026-06-24 提出。mergeable、修正すべき CI 失敗なし（`UNSTABLE` は upstream 側の良性状態） |
| awesome-code-review   | [#131](https://github.com/joho/awesome-code-review/pull/131)               | ⏳ Open・マージ待ち           | 2026-06-24 提出。mergeable、レビュー未着                                                  |
| awesome-ai-devtools   | [#697](https://github.com/jamesmurdza/awesome-ai-devtools/pull/697)        | ⏳ Open・マージ待ち           | 2026-06-24 提出（旧 #696 は差し替えのため CLOSED）。mergeable、レビュー未着               |
| awesome-ai-agents     | —                                                                          | 未提出                        | Marginal 適合のため優先度低（下記参照）                                                   |

## 提出材料ドラフト

各リストの実際の README / CONTRIBUTING を確認して作成したコピペ用ドラフト。fork → 該当箇所に追記 → PR の流れで使う（外部リポジトリへの操作はリポジトリ管理者が実施）。提出直前に各リストの規約が変わっていないか再確認すること。提出済み PR の状態は上記「提出状況（トラッキング）」を参照。

### awesome-actions（sdras/awesome-actions）

- 追記先: `### Pull Requests` セクションの**末尾**。
- 規約: Title Case、1 行（3 行に折り返さない）、太字/斜体なし、重複確認、PR タイトルは具体的に、コミット本文にリポジトリ URL を含める。

追記する 1 行:

```md
- [River Review](https://github.com/s977043/river-review) - Review pull requests against your team's versioned, repo-owned review skills across plans, diffs, and tests.
```

PR タイトル: `Add River Review to Pull Requests`

PR / コミット本文:

```text
Adds River Review to the Pull Requests section.

River Review is a GitHub Action that runs a team's review standards as
versioned, repo-owned skills across plans, diffs, tests, and prior reviews.
Human-in-the-loop, not auto-merge.

Repository: https://github.com/s977043/river-review
```

### awesome-code-review（joho/awesome-code-review）

- 追記先: `## Tools` セクション。**アルファベット順**で `Review Board` と `Sider` の間。
- 規約: 1 リンク、リンクテキストはツール名、説明はリンクの後に同一行で句読点終わり、**非宣伝的**トーン。

追記する 1 行:

```md
- [River Review](https://github.com/s977043/river-review) Open source framework that runs review standards as versioned, repo-owned skills across plans, diffs, tests, and prior reviews.
```

PR タイトル: `Add River Review to Tools`

### awesome-ai-devtools（jamesmurdza/awesome-ai-devtools）

- 追記先: `### PR & Code Review Bots` セクションの**末尾**（このリストは投稿順）。
- 規約: `[Name](link)` の後ろにダッシュ区切りで説明文を続ける形式（下記コードブロックの実エントリを参照）。既存の crit / PR Triage と同様、human-in-the-loop / OSS を明示すると差別化が伝わる。

追記する 1 行:

```md
- [River Review](https://github.com/s977043/river-review) — Open source, team-owned review layer: codify review judgment as repo-owned skills and run them across plans, diffs, tests, and prior reviews. Human-in-the-loop, not auto-merge.
```

PR タイトル: `Add River Review to PR & Code Review Bots`

## 注意点

- 各リストの掲載ルールは申請時点の CONTRIBUTING / PR テンプレートで再確認する。
- 説明文は非宣伝的トーンを保ち、OpenSSF / CI / CodeQL などの trust signal は事実ベースで触れる。
- npm 公開を前提にした説明にはしない（[プロジェクト方針](../../README.md#はじめる)）。
