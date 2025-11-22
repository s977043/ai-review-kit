# Roadmap: AI Review Kit (Review OS)

## Vision

単なる自動レビューツールではなく、開発組織の品質基準をコード化・運用・監査する「Review OS」へ進化させる。

## Strategy

"Metadata First" —— すべてのレビューロジック、設定、そして戦略自体を構造化データ（Markdown + Frontmatter）として管理し、決定論的な制御と自律的な改善を実現する。

## Phase 0: Foundation (The Schema)

### Goal

スキル定義の規格化と、最小実行環境の整備。テキストベースのプロンプト管理から脱却し、システムが解釈可能なスキーマ基盤を確立する。

### Key Objectives

- [ ] **Define Metadata Schema** (`metadata.schema.json`): スキル定義の厳格な仕様策定（ID、Version、Severity、Phase）を行う。
- [ ] **Define Output Contract** (`output.schema.json`): LLM出力のJSON構造定義（Issue、Rationale、Impact）を決める。
- [ ] **Establish Rubric** (`rubric.yaml`): 重大度（Severity）とフェーズの定義を行う。
- [ ] **MVS (Minimum Viable Skill) Structure**: `skills/core` ディレクトリを整備し、最小のスキルを実装する。

### Exit Criteria

- `metadata.schema.json` が定義され、CIでバリデーションが通る状態になること。
- 既存のプロンプトが1つ以上、新しいMVS形式に移行されていること。

## Phase 1: Migration & Coverage (The Content)

### Goal

既存スキルの移行と、品質特性（ISO 25010）に基づくカバレッジ拡大。「動く」状態から「使える」状態へ移行し、開発者がメリットを感じられるラインを目指す。

### Key Objectives

- [ ] **Skill Migration**: 既存のテキストプロンプトを Markdown + Frontmatter 形式へ完全移行する。
- [ ] **Domain Separation**: `skills/{language}/{domain}` （例: `python/security`）へのディレクトリ再編を行う。
- [ ] **Quality Tagging**: 全スキルに ISO 25010 品質特性タグ（Security、Maintainability 等）を付与する。
- [ ] **Basic Runner Implementation**: メタデータを解釈し、単純なフィルタリング（Phase/Severity）を行うランナーを実装する。

### Exit Criteria

- 全ての既存スキルが新フォーマットに移行完了している。
- `phase: [design]` や `severity: critical` などの条件でレビューを実行できる状態になっている。

## Phase 2: Reliability & Testing (The Guardrails)

### Goal

プロンプトの「ソフトウェア化」を完了し、CI/CD パイプラインへ統合する。プロンプトの変更がデグレを起こさないことを保証する仕組みを作る。

### Key Objectives

- [ ] **Evals Framework Setup**: Promptfoo 等を用いたプロンプト評価環境を構築する。
- [ ] **Golden Datasets**: 各スキルの「検出すべきバグ」と「誤検知すべきでないコード」のテストケースを作成する。
- [ ] **Prompt CI**: スキル変更時に自動テストが走る GitHub Actions ワークフローを整備する。
- [ ] **Version Control Policy**: スキルのセマンティックバージョニング運用を開始する。

### Exit Criteria

- スキル変更のPRにおいて、回帰テストが自動実行され、品質低下をブロックできる。

## Phase 3: Intelligence (The Brain)

### Goal

静的なルール適用から、コンテキストに応じた動的なルーティングへ移行し、無駄なトークン消費を抑えつつレビュー精度を最大化する。

### Key Objectives

- [ ] **Semantic Routing**: PRの内容（Title/Description/Diff）に基づき、適用すべきスキルを動的に選択するルーターを実装する。
- [ ] **Context Awareness**: 変更ファイルだけでなく、依存関係にあるファイルを RAG 的に参照する仕組みを用意する。
- [ ] **Suppression System**: ユーザーの「Wontfix」フィードバックを学習またはIDベースで抑制する機能を追加する。

### Exit Criteria

- PRの内容に応じて、無関係なスキルの実行がスキップされ、コストが最適化されている状態。

## Phase 4: Autonomy (The Agent)

### Goal

「指摘する」存在から「協働する」存在へ。複数の専門エージェントが連携し、複雑な問題を解決する。

### Key Objectives

- [ ] **Orchestrator Pattern**: 複数のスキル（Security、Performance など）を並列実行し、結果を統合・要約するオーケストレーターを実装する。
- [ ] **Review Session State**: レビューの対話履歴を保持し、修正後の再レビューで「以前の指摘が直ったか」を確認する機能を構築する。
- [ ] **Self-Improvement Loop**: 運用データに基づき、ロードマップ自体やスキル改善案をAIが提案するフローを整備する。

### Exit Criteria

- 複数の専門スキルが協調して1つの統合されたレビューレポートを作成できる。

## GitHub Projects セットアップ推奨事項

このロードマップを運用に乗せるために、GitHub Projects (V2) で以下の「Custom Fields」を設定することをおすすめします。

- **Phase (Single Select)**:
  - Phase 0: Foundation
  - Phase 1: Migration
  - Phase 2: Reliability
  - Phase 3: Intelligence
  - Phase 4: Autonomy
  これにより、各タスクがロードマップのどこに位置するかを可視化できます。
- **Component (Single Select)**:
  - Schema
  - Runner
  - Skill Definition
  - Evals
  アーキテクチャのどの部分への変更かを分類します。
- **ビューの作成**:
  - **Roadmap View**: Target Date と Phase を軸にしたガントチャート表示。
  - **Kanban View**: 日々のタスク消化用（Status 別）。

この構成により、戦略（ROADMAP.md）と戦術（GitHub Issues）が綺麗に接続され、AIによる進捗監査も容易になります。