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

`v1` タグを使った最小構成のワークフロー例です。`phase` は将来拡張を見据えた任意入力で、SDLC のフェーズごとにスキルを振り分けます。

```yaml
name: River Reviewer
on:
  pull_request:
    branches: [main]
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - name: Run River Reviewer (midstream)
        uses: s977043/river-reviewer@v1
        with:
          phase: midstream # upstream|midstream|downstream|all (future-ready)
```

新しいタグが出たら、`@v1` を最新のリリースタグに置き換えてください。

## クイックスタート（ローカル）

1. 環境: Node 18+ 推奨（CI も Node 18 系で運用）
2. 依存導入: `npm install`
3. スキル検証: `npm run skills:validate`
4. テスト: `npm test`
5. Planner 評価（任意）: `npm run planner:eval`
6. ドキュメント開発（任意）: `npm run dev`（Docusaurus）

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
- スキーマ: スキルメタデータは `schemas/skill.schema.json`, レビュー出力は `schemas/output.schema.json`
- 参考: スキルスキーマの詳細は `pages/reference/skill-schema-reference.md`、Riverbed Memory の設計ドラフトは `pages/explanation/riverbed-memory.md`

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

## コントリビューション

ガイドラインは `CONTRIBUTING.md` を参照してください。Issue や PR を歓迎します。

## ライセンス

- `LICENSE`: リポジトリ構成と設定は Apache-2.0
- `LICENSE-CODE`: コードとスクリプトは MIT
- `LICENSE-CONTENT`: ドキュメントとメディアは CC BY 4.0
