# Improvement Flow: 学びをプロセスに反映する

セッションで得た学びを再現可能な形に codify するための運用フロー。このドキュメント自体も過去のセッションで「暗黙の振り返りループ」を回していた結果を明文化したもの。

## 背景

River Review の運用で同じミスを繰り返し、そのたびに「次回から気をつける」で終わっていた時期があった。以下のような incident がセッションを跨いで再発した:

- Issue 作成時にコードベースを調査せず、既に実装済みの機能に対して Issue を作成（8件）
- パイプライン関数に新パラメータを追加する際、`local-runner.mjs` への転送漏れが2 PR連続で発生
- 複数 PR のマージ順序を計画せずに `review-engine.mjs` でコンフリクト
- `git stash`/`git checkout` の誤操作で作業ファイルを2回失う
- git コマンド出力の branch 名を読み飛ばし、意図と異なるブランチに commit

こうした再発を防ぐため、学びを必ず形にする Improvement Flow を導入する。

## いつ使うか

以下のいずれかに該当する場合に適用する:

- 同じクラスのミスが2回以上発生した
- Guardrail があれば防げたミスが起きた
- 再利用可能なパターンを発見した（新しいコマンドや checklist のネタになる）

一度しか起きていないミスのためにルールを作らない（過剰な形式化を避ける）。

## フロー

### Step 1: 学びの整理

以下を言語化する:

- **What**: 何が起きたか
- **How many**: 何回発生したか
- **Cost**: 失われた時間・作業量
- **Root cause**: 根本原因（トリガーは何だったか）

### Step 2: 成果物の分類

学びをどの形で固定化するかを決める:

| 形                                 | 使いどき                                                           | 例                                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| CLAUDE.md の AI Misoperation Guard | リポジトリ固有の行動ルール（全セッションに適用）                   | "Commit before branch switches"                                                                              |
| `.claude/commands/*.md`            | 繰り返し実行する手順で、step-by-step のガイドが必要                | `/propose-issue`, `/plan-merge-order`                                                                        |
| `docs/development/*.md`            | コードベース固有のリファレンス / チェックリスト                    | `pipeline-params-checklist.md`, このドキュメント                                                             |
| Auto-memory (`feedback_*.md`)      | リポジトリ非依存で cross-session な習慣（git/editor の reflex 等） | `feedback_git_wip_commit.md`                                                                                 |
| `scripts/*.mjs` + 必須 CI チェック | 宣言と実体の一致を決定論で検証できるもの（件数・列挙・参照の整合） | `scripts/check-doc-enumerations.mjs`（`npm run meta:validate` 経由で必須チェック `Meta consistency` に接続） |

まず「mechanical に検証できるか」を確認する。決定論で検証できるなら、手順ではなく検証を書く（script + 必須 CI チェック）。散文のチェックリストは守られない前提で設計する。2026-08-02 の実測で、機械が検証している参照の乖離率は 0.18% だった。一方、CI 非対象の人手列挙は 20 件サンプルのうち 18 件が陳腐化していた（測定範囲と出典は [doc-enumeration-checks.md](./doc-enumeration-checks.md) を参照）。検証へ落とせない場合だけ「mechanical に実行できるか」で分類する。実行手順なら command、判断を要する行動原則なら guard、call site リストなら docs。

### Step 3: ドラフト作成

- 既存パターン（frontmatter, tone, 構造）に揃える
- 具体コマンドを併記する（抽象的な指示は避ける）
- 動機となった incident を PR 本文や commit message に含める（ルール本体には含めない）
- 早めに中間コミットして work を保護する

### Step 4: セルフレビュー

`/review-local` または手動で以下を確認:

- **Clarity**: 未来のセッションが mechanical に実行できるか
- **Consistency**: 既存の成果物と tone/format が揃っているか
- **Correctness**: ツール・コマンドの挙動が実態と一致しているか
- **Scope**: 特定の incident に寄りすぎず、class of errors をカバーしているか

### Step 5: Multi-agent Review（3観点）

`river-review` サブエージェントを **1メッセージ内で3つの Task invocation として同時発行** する（serialize させないため）:

- **Quality Review**: rule の明確さ、actionability、既存ルールとの整合性
- **Code Reuse Review**: AGENTS.md / CLAUDE.md / `.claude/rules/` / 既存 docs との重複
- **Efficiency/Accuracy Review**: 参照するコマンド・ファイル・行番号の正確性、隠れた gotcha

この3観点は経験則として指摘が集まりやすいカテゴリ。

### Step 6: 指摘の適用

- **Major**: 必ず修正（AGENTS.md との矛盾、fabricated references、scope creep など）
- **Minor**: 判断して適用（tone drift、オーバースペック、重複注意など）
- **Info**: 記録のみ or 将来の改善ネタとして保留

指摘が誤っている場合（ソースを verify して誤指摘が判明した場合）は受け入れず、PR 本文で経緯を説明する。

### Step 7: PR 作成・マージ

`/pr` コマンドで PR 本文を下書きし、以下を含める:

- 背景となる incident
- 追加したルール・コマンド・docs の列挙
- レビュー指摘と対応サマリ

マージは squash merge を使う（リポジトリ convention）。

### Step 8: メモリ保存

セッション間で持続させたい学びは `feedback_*.md` として auto-memory に保存し、`MEMORY.md` インデックスを更新する。

## Dogfooding

このフロー自体を Improvement Flow に従って改善する。

- フロー適用後、**このドキュメント**に改善点がないか振り返る
- 新しい incident class が見つかったら、このドキュメントに追記する
- 過剰形式化の兆候（lint されない項目が増える、守られない rule が増える）が見えたら簡素化する

## アンチパターン

- 1回しか起きていない incident のために rule を作らない（過剰形式化）
- AGENTS.md の内容を CLAUDE.md に重複させない（メンテナンス負荷）
- Multi-agent review をスキップしない（経験則として Major 指摘が毎サイクル出る）
- CLAUDE.md の bullet に incident narrative を書かない（imperative tone が崩れる。narrative は PR 本文へ）
- レビュー指摘を鵜呑みにしない（誤指摘もある、要ソース検証）

## 過去の適用実績

最新の状況は `git log CLAUDE.md` および `git log docs/development/` で確認すること。以下は初回 codification 時点のスナップショット。

| マージ日   | 学び                         | 成果物                                          |
| ---------- | ---------------------------- | ----------------------------------------------- |
| 2026-04-11 | Issue 作成前の調査不足       | `/propose-issue` コマンド                       |
| 2026-04-11 | パラメータ伝播漏れ           | `docs/development/pipeline-params-checklist.md` |
| 2026-04-11 | マージ順序未計画             | `/plan-merge-order` コマンド                    |
| 2026-04-11 | `git stash` 事故             | CLAUDE.md "Commit before branch switches"       |
| 2026-04-11 | git 出力 branch 名読み飛ばし | CLAUDE.md "Verify git output before chaining"   |
| 2026-04-09 | main の Lint failure 波及    | CLAUDE.md "Verify CI green before merge"        |

## 関連

- `CLAUDE.md`—AI Misoperation Guards
- `AGENTS.md`—全 agent 共通ルール（Safety, Edit Scope）
- `.claude/commands/`—カスタムコマンド
- `docs/development/pipeline-params-checklist.md`—具体的な checklist 例
