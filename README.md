# River Reviewer

![River Reviewer logo](assets/logo/river-reviewer-logo.svg)

日本語版 README です。[English README is available here.](./README.en.md)

流れに寄り添う AI レビューエージェント。River Reviewer はフロー型・メタデータ駆動の AI レビューエージェントで、設計意図・実装判断・テストカバレッジを SDLC 全体でつなぎます。

## フローのストーリー

- **上流（設計）**: ADR を踏まえたチェックでコードのドリフトを防ぎ、アーキテクチャ判断との整合を保ちます。
- **中流（実装）**: スタイルと保守性のガードレールで日々のコーディングを支援します。
- **下流（テスト/QA）**: テスト指向のスキルがカバレッジ不足や失敗パスを浮かび上がらせます。
- **フェーズ指向ルーティング**: `phase` とファイルメタデータを見て、開発段階に合ったスキルを選択します。

## クイックスタート（GitHub Actions）

`v1` タグを使った最小構成のワークフロー例です。`phase` は将来拡張を見据えた任意入力で、SDLC のフェーズごとにスキルを振り分けます。Permissions/fetch-depth などを明示して安定動作させます。

```yaml
name: River Reviewer
on:
  pull_request:
    branches: [main]
jobs:
  review:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      issues: write
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0 # merge-base を安定取得
      - name: Run River Reviewer (midstream)
        uses: s977043/river-reviewer/.github/actions/river-reviewer@v0.1.1
        with:
          phase: midstream # upstream|midstream|downstream|all (future-ready)
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

タグは `@v0.1.1` などのリリースタグにピン留めしてください。浮動タグを使う場合は `@v0` のようなエイリアスタグを用意して運用します（任意）。

最新リリース: [v0.1.1](https://github.com/s977043/river-reviewer/releases/tag/v0.1.1)

### 高度な設定例

- フェーズ別レビューを並列実行（上流・中流・下流を個別ジョブに分割）

```yaml
jobs:
  review-upstream:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with: { fetch-depth: 0 }
      - uses: s977043/river-reviewer/.github/actions/river-reviewer@v0.1.1
        with: { phase: upstream }
        env: { OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }} }

  review-midstream:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with: { fetch-depth: 0 }
      - uses: s977043/river-reviewer/.github/actions/river-reviewer@v0.1.1
        with: { phase: midstream }
        env: { OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }} }

  review-downstream:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with: { fetch-depth: 0 }
      - uses: s977043/river-reviewer/.github/actions/river-reviewer@v0.1.1
        with: { phase: downstream }
        env: { OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }} }
```

- コスト見積もりと上限の例

```yaml
review:
  runs-on: ubuntu-latest
  if: "!contains(github.event.pull_request.title, '[skip-review]')" # タイトルでスキップ
  steps:
    - uses: actions/checkout@v6
      with: { fetch-depth: 0 }
    - uses: s977043/river-reviewer/.github/actions/river-reviewer@v0.1.1
      with:
        phase: midstream
        estimate: true # コスト見積もりのみ
        max_cost: 1.5 # USD 上限、超過で終了
      env:
        OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

- Draft/Ready でレビュー強度を変える例

```yaml
  review-light:
    if: github.event.pull_request.draft == true
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with: { fetch-depth: 0 }
      - uses: s977043/river-reviewer/.github/actions/river-reviewer@v0.1.1
        with:
          phase: midstream
          dry_run: true            # Draft はドライランでプロンプト確認のみ
          debug: true
        env: { OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }} }

  review-full:
    if: github.event.pull_request.draft == false
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with: { fetch-depth: 0 }
      - uses: s977043/river-reviewer/.github/actions/river-reviewer@v0.1.1
        with:
          phase: midstream
          dry_run: false           # Ready ではフルレビュー
        env: { OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }} }
```

### セキュリティ考慮事項

- `OPENAI_API_KEY` は必ず Repository Secrets に設定し、`env:` で参照する
- Private リポジトリでは必要な permissions（contents, pull-requests）を明示する
- `fetch-depth: 0` でマージベースを正しく取得し、誤差分を避ける

## クイックスタート（ローカル）

1. 環境: Node 20+ 推奨（CI も Node 20 系で運用）
2. 依存導入: `npm install`
3. スキル検証: `npm run skills:validate`
4. テスト: `npm test`
5. Planner 評価（任意）: `npm run planner:eval`
6. ドキュメント開発（任意）: `npm run dev`（Docusaurus）

### ローカルレビュー実行（river run .）

1. インストール後に `npx river run . --dry-run`（または `npm run river -- --dry-run`）で現在の差分を対象にローカルレビューを実行（GitHub への投稿なし）
2. `--debug` を付けるとマージベース、対象ファイル一覧、プロンプトのプレビュー、トークン見積もり、diff 抜粋を標準出力へ表示
3. OpenAI の LLM を使う場合は `OPENAI_API_KEY`（または `RIVER_OPENAI_API_KEY`）を設定して `river run .` を実行。未設定時はスキルベースのヒューリスティックコメントでフォールバック
4. `--dry-run` は外部 API を呼ばず標準出力のみ。`--phase upstream|midstream|downstream` でフェーズ指定も可能（デフォルトは `RIVER_PHASE` 環境変数または `midstream`）
5. コンテキスト/依存の制御: `RIVER_AVAILABLE_CONTEXTS=diff,tests` や `RIVER_AVAILABLE_DEPENDENCIES=code_search,test_runner` を設定すると、スキル選択時に要求を満たさないものを理由付きでスキップできます（未設定の場合は依存チェックをスキップ）。
6. CLI で直接指定する場合: `--context diff,fullFile` や `--dependency code_search,test_runner` フラグで環境変数を上書きできます（逗号区切り）。
7. 依存のスタブ有効化: `RIVER_DEPENDENCY_STUBS=1` を指定すると、既知の依存（`code_search`, `test_runner`, `coverage_report`, `adr_lookup`, `repo_metadata`, `tracing`）を「利用可能」とみなしてスキップを防ぎます。実装準備中の環境でプランだけ確認したいときに使用してください。

## Project-specific review rules

- リポジトリルートに `.river/rules.md` を置くと、プロジェクト固有のレビューポリシーが LLM プロンプトへ自動注入されます（`river run .` と GitHub Actions の双方で有効）
- ファイルが無い/空の場合は従来通り。読み込みエラー時のみ失敗します
- 例（.river/rules.md）:
  - Next.js App Router を前提とし、`pages/` ディレクトリは使用しない
  - React サーバーコンポーネントを優先し、クライアントコンポーネントは必要な場合のみ使う
  - ビジネスロジックは hooks ではなく service モジュールに寄せる

## Diff Optimization（差分最適化）

- River Reviewer は lockfile や Markdown、コメント・フォーマットのみの変更を自動で除外し、LLM に渡すトークン量を削減します
- 大きな差分はハンク単位で圧縮し、必要な変更周辺のみを送信してコストとノイズを低減します
- `river run . --debug` で最適化前後のトークン見積もりと削減率を確認できます

## スキル

スキルは YAML フロントマター付き Markdown で記述し、メタデータを使ってロードとルーティングを行います。

### LLM ベースのスキル選択（Skill Planner）

LLM を使ったスキル選択はプランナー関数を差し込むだけで利用できます。具体例は `docs/skill-planner.md` のミニマム実装例を参照してください。LLM 未指定の場合は従来通り決定論的に並び替えて実行します。

Planner 統合後の全体アーキテクチャ（metadata → loader → planner → runner）は `docs/architecture.md` にまとめています。

Planner の出力品質を簡易評価する手順とメトリクスは `docs/planner-evaluation.md` を参照してください（`npm run planner:eval` で実行）。

```markdown
---
id: rr-midstream-code-quality-sample-001
name: Sample Code Quality Pass
description: Checks common code quality and maintainability risks.
phase: midstream
applyTo:
  - 'src/**/*.ts'
tags: [style, maintainability, midstream]
severity: minor
---

- Instruction text for the reviewer goes here.
```

- サンプル: `skills/upstream/sample-architecture-review.md`, `skills/midstream/sample-code-quality.md`, `skills/downstream/sample-test-review.md`
- examples: `examples/README.md`
- スキーマ: スキルメタデータは `schemas/skill.schema.json`, レビュー出力は `schemas/output.schema.json`
- 参考: スキルスキーマの詳細は `pages/reference/skill-schema-reference.md`、Riverbed Memory の設計ドラフトは `pages/explanation/riverbed-memory.md`
- 既知の制限: `pages/reference/known-limitations.md`

## AI レビュー標準ポリシー

River Reviewer は、品質と再現性を保つための標準レビューポリシーに従って動作します。このポリシーは、評価方針・出力形式・禁止事項を定義し、建設的で具体的なフィードバックを提供します。

- **評価方針**: 差分からの意図理解、危険性の特定、影響範囲の評価
- **出力形式**: Summary（要約）、Comments（具体的指摘）、Suggestions（改善提案）
- **禁止事項**: 過度な推測、抽象的なレビュー、不適切なトーン、範囲外の指摘

詳細は [AI レビュー標準ポリシー](pages/reference/review-policy.md) を参照してください。

## ドキュメント設計

River Reviewer の技術ドキュメントは、[Diátaxis ドキュメントフレームワーク](https://diataxis.fr/) に基づいて構成しています。日本語がデフォルト言語で、英語版は `.en.md` 拡張子の別ファイルとして管理します（差分がある場合は日本語版を優先）。

ドキュメントは次の 4 種類に分類されます。

- Tutorials（チュートリアル）: 学習志向。最初の成功体験のためのレッスン。
- Guides（ハウツーガイド）: タスク志向。特定のゴールを達成するための手順。
- Reference（リファレンス）: 仕様・API・スキーマなどの事実の一覧。
- Explanation（解説）: 背景・設計思想・なぜそうなっているかの説明。

`/docs` 配信（ソースは `pages/`）で上記 4 種をマッピングし、ファイル名で言語を表します。

- `pages/tutorials/*.md`（日本語）と `pages/tutorials/*.en.md`（英語）
- `pages/guides/*.md` と `pages/guides/*.en.md`
- `pages/reference/*.md` と `pages/reference/*.en.md`
- `pages/explanation/*.md` と `pages/explanation/*.en.md`

## ロードマップ

- 上流 → 中流 → 下流にわたるフェーズ別レビュー拡張
- ADR などの履歴を保持する Riverbed Memory（WontFix や過去指摘も含む）
- Evals / CI 連携による継続的な信頼性検証

進捗のソース・オブ・トゥルースは Milestones と Project です（README の箇条書きは概観のみ）。

- Milestones: [river-reviewer/milestones](https://github.com/s977043/river-reviewer/milestones)
- Project: [プロジェクトボード](https://github.com/users/s977043/projects/2)

（任意）Issue に `m1-public` / `m2-dx` / `m3-smart` / `m4-community` のいずれかを付与すると、Milestone を自動で設定します（`.github/workflows/auto-milestone.yml`）。

## トラブルシューティング

詳細は `pages/guides/troubleshooting.md` を参照してください。

## コントリビューション

ガイドラインは `CONTRIBUTING.md` を参照してください。Issue や PR を歓迎します。

## ライセンス

本リポジトリは複数ライセンス（ファイル種別ごと）を採用しています。

- `LICENSE-CODE`（MIT）: コードとスクリプト
  - 例: `src/**`, `scripts/**`, `tests/**`
- `LICENSE-CONTENT`（CC BY 4.0）: ドキュメント、テキスト、メディア
  - 例: `pages/**`, `skills/**`, `assets/**`,（ルート直下の）`*.md`
- `LICENSE`（Apache-2.0）: リポジトリ構成（scaffolding）と設定（configuration）
  - 例: `.github/**`, `docusaurus.config.js`, `sidebars.js`, `package*.json`, `*.config.*`, `.*rc*`

追加するファイルのライセンス方針に迷う場合は、PR で明示して相談してください。
