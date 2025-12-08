# AGENTS.md—River Reviewer agent guide

River Reviewer は「流れに寄り添う」AI レビューエージェントです。  
このリポジトリには、River Reviewer のドキュメント、スキーマ、検証ユーティリティがまとまっています。  
人間と AI コーディングエージェントが、安全かつ一貫した変更を行うためのルールをまとめています。

---

## 0. 原則

- 小さく変更 → 検証コマンド → PR → Green 確認 → レビュー
- 設定ファイルを真実の源泉とし、フォーマッタ / lint を必ず通す
- 秘密情報は持ち込まない（`.env*` は禁止、例示はダミー値で）

---

## 1. セットアップと共通コマンド（npm 前提）

- 依存導入（CI/再現性重視）: `npm ci`
- ローカル開発インストール: `npm install`
- ドキュメント開発サーバ（Docusaurus）: `npm run dev`
- ドキュメントビルド: `npm run build`
- テスト（Node.js test runner）: `npm test`
- Lint 一式（Prettier / markdownlint / textlint など）: `npm run lint`
- エージェント定義検証: `npm run agents:validate`
- スキル定義検証: `npm run skills:validate`
- OpenTelemetry トレース検証（必要時のみ）: `npm run trace:validate`
- Planner 評価（任意・オフラインベンチ用）: `npm run planner:eval`

PR/CI では少なくとも `npm test` と `npm run lint` を通し、変更内容に応じて `agents:validate` / `skills:validate` を実行してください。

---

## 2. ディレクトリ構成と編集範囲

主に編集対象:

- `pages/`: Docusaurus 用ソースドキュメント（Diátaxis: tutorials/guides/reference/explanation）
- `skills/`: YAML フロントマター付き Markdown のレビュー「スキル」定義
- `schemas/`: `skill.schema.json`, `output.schema.json` などの JSON Schema
- `scripts/`: `validate-*.mjs`, `fix-dashes.mjs` などユーティリティ
- `tests/`: Node.js test runner 用のテスト
- `.github/`: GitHub Actions 等の CI 設定

慎重に扱う/原則手動編集しない:

- `docs/`: 公開用生成物を想定。編集は通常 `pages/` 側で行う
- `assets/`: 各種アセット
- `LICENSE*`, `CITATION.cff`: ライセンス/引用情報
- `package-lock.json`: `npm ci` で再生成。手作業で書き換えない

AI エージェントは「主に編集対象」を優先し、それ以外は必要最小限にとどめてください。

---

## 3. コーディング / ドキュメントスタイル

- フォーマット: Prettier (`**/*.{js,json,md,yml,yaml}` 対象). 設定は `.prettierrc.json`
- JavaScript/Node: ESM, `node --test` を使用
- Markdown: `markdownlint` ルールは `.markdownlint*.json[c]`; 日本語は `textlint` + `prh` に従う
- ドキュメント言語ポリシー: 日本語がソース・オブ・トゥルース。英語版は `*.en.md` がありうるが差分がある場合は日本語優先
- 必ず `npm run lint` を通してから PR

---

## 4. スキルとエージェント定義に関するルール

### スキル定義（`skills/`）

- 形式: YAML フロントマター付き Markdown
- 主なフィールド: `id`, `name`, `description`, `phase`, `applyTo`, `inputContext`, `outputKind`, `modelHint`, `dependencies`, `tags`, `severity` など（詳細は `docs/skill-metadata.md`）
- 変更後に実行: `npm run skills:validate` および `npm test`（該当があれば）

### エージェント/トレース

- エージェント設定やトレース関連を触ったら `npm run agents:validate`
- 必要に応じて `npm run trace:validate` で OpenTelemetry 経由の挙動確認

---

## 5. コミット / PR ルール（簡易まとめ）

詳細は `CONTRIBUTING.md` と `COMMIT_SUMMARY_JA.md` を参照。最低限:

- コミット前に: `npm test`, `npm run lint`, 変更に応じて `agents:validate` / `skills:validate`
- PR本文に: 目的 / 変更内容 / 影響範囲 / 実行コマンドと結果を記載

---

## 6. セキュリティ

- `.env*` はコミットしない（例示はダミー値で）
- 外部 API を呼ぶ場合はタイムアウトと例外処理を必須にする

---

## 7. AI コーディングエージェント向けメモ

- このリポは「AI レビューエージェント」そのものの定義・スキルを含む。仕様変更前に `schemas/*.json` と既存 `skills/` の整合を確認。
- 大きな変更は小さく刻み、必ずテストと検証スクリプトで裏を取ってから PR。
- 不明な場合は README と `docs/architecture.md`（Planner/Runner 概要）、`docs/skill-planner.md` を参照。
