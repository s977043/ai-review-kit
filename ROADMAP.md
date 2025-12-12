# Roadmap: River Reviewer

## Vision

単なる自動レビューツールではなく、開発組織の品質基準をコード化・運用・監査する「Review OS」へ進化させる。

## Strategy

"Metadata First"—すべてのレビューロジック、設定、そして戦略自体を構造化データ（Markdown + Frontmatter）として管理し、決定論的な制御と自律的な改善を実現する。

- **Flow-based**: フェーズ別（upstream/midstream/downstream）のスキルで、開発フローに寄り添う非ブロッキングなレビューを行う。
- **Metadata-first**: YAML frontmatter + Markdown を「スキル」とし、`schemas/skill.schema.json` で厳格に定義・検証する。
- **Automation-ready**: GitHub Actions など CI/CD から容易に呼び出せるランナーとルーティング層を用意する。

## Phase 0: Branding & Foundation (完了)

- [x] River Reviewer へのリブランディング（README/用語集/スキーマ説明）
- [x] ディレクトリ整備：`skills/{upstream,midstream,downstream}`、`schemas/`、`docs/`、`assets/`
- [x] スキルメタデータ JSON Schema (`schemas/skill.schema.json`)
- [x] ブートストラップスクリプト（`scripts/setup_river_reviewer.sh`）とリファクタスクリプト（`scripts/rr_validate_skills.py`）
- [x] 最小 GitHub Actions ワークフロー雛形 (`.github/workflows/river-reviewer.yml`)
- Exit Criteria: 達成（基本ドキュメントとスキーマ/スクリプトが揃い、新規スキル追加の足場がある）。

## Phase 1: Skill Migration & Coverage

- [x] スキル定義を `skills/**/*.md` に集約（YAML frontmatter をスキーマ準拠で付与）
- [x] ID プレフィックスを `rr-` に正規化
- [x] Upstream/Midstream/Downstream それぞれに本番想定スキルを追加（設計ガードレール、実装レビュー、QA/回帰確認など）
- [x] Quality/Domain タグ付け（例: `performance`, `security`, `reliability`）
- Exit Criteria: 各フェーズに少なくとも1つ以上の本番想定スキルが配置され、スキーマ検証を通過する。

## Phase 2: Loader & Runner (Phase-aware Routing)

- [x] `skills/**/*.md` を再帰的に読み込み、`phase` でフィルタ可能なローダーを実装（`RIVER_PHASE` / `--phase` 対応）
- [x] スキルメタデータの JSON Schema バリデーションを Runner に組み込み（Ajv）
- [x] GitHub Actions/CLI ラッパーを整備し、midstream をデフォルトにフェーズ切替を可能にする
- [x] Stream Router の下地として、変更ファイルのグロブと `applyTo` の突合を追加
- Exit Criteria: フェーズ指定でスキルを実行でき、メタデータのバリデーションを通過したものだけが走る。

### 次の具体タスク案（Phase 3 着手用）

- [ ] ゴールデンケース（差分・期待出力）を fixtures として追加し、回帰を検知できるテストを追加
- [ ] スキルごとの失敗パス（コンテキスト不足/依存不足）をテストで検知
- [ ] Evals/回帰テストを CI へ組み込み、スキル変更時に必ず実行

## Phase 3: Reliability & Evals

- [ ] Prompt/Evals 環境の整備（例: Promptfoo）とゴールデンケースの準備
- [ ] スキルごとの「検出すべき/避けるべき」テストケースを追加し、回帰を検知
- [ ] CI にスキル回帰テストを組み込み、失敗時はブロック
- Exit Criteria: スキル変更で自動評価が走り、デグレを防止できる。

## Phase 4: Riverbed Memory & Intelligence

- [ ] Riverbed Memory の設計（ADR/WontFix/過去指摘の永続化と再利用）
- [ ] セマンティック/コンテキストルーティング（PR タイトル/差分/依存関係を考慮）
- [ ] 抑止・再提示の仕組み（抑制した指摘の再浮上条件を定義）
- Exit Criteria: コンテキストに応じたスキル選択が行われ、不要実行が削減される。

## GitHub Projects 推奨フィールド

- **Phase (Single Select)**: Phase 0〜4（上記に対応）
- **Component (Single Select)**: Schema / Loader / Runner / Skills / Evals / Memory
- **View 例**:
  - Roadmap View: Target Date × Phase のタイムライン
  - Kanban View: Status 別の進行管理

この構成で、フェーズ別の進捗とコンポーネント別の責務を可視化し、River Reviewer の流れに沿った開発管理を行う。
