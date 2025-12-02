# AGENTS.md—AI Agent Guide (Template)

> **テンプレートです。** 各プロジェクトの技術選定/運用に合わせて
> 不要な節は **削除**、コマンドは **読み替え**、ルールは **上書き** してください。
> （AIエージェントが迷わないこと／人間にも読めることを最優先に）

本ドキュメントは **AI支援型TDD（AI-TDD）** を前提に、複数エージェント（Codex CLI / Gemini CLI など）が迷わず作業できる標準手順の**たたき台**です。

## 0. 原則（短く、正しく、検証可能に）

- 小さく変更 → テストで裏取り → PR → Green確認 → レビュー

- 曖昧語を避け、**具体コマンド／期待出力**を書く

- 秘密情報を持ち込まない（`.env` はコミット禁止／例は `.env.example`）

## 1. スコープ（例）

- 想定構成：`apps/*`, `packages/*`

- 触ってよい：実装・テスト・Lint/型・ドキュメント

- 触らない：`/docs/generated`, `**/*.lock`, `.env*`, `secrets/*` など

## 2. セットアップ & 共通コマンド（例：pnpm）

- 依存導入: `pnpm i`

- Lint: `pnpm lint`

- 型検査: `pnpm tsc -b`（必要な場合）

- テスト: `pnpm test`

- パッケージ絞り込み: `pnpm turbo run test --filter <pkg>`

## 3. コーディング（例：設定ファイルを“真実の源泉”に）

- TS は `strict` を維持（または言語/設定に準ずる）

- ESLint/Prettier 等、**設定＝事実上の規約**

- 命名：変数/関数=camelCase, 型/コンポーネント=PascalCase（プロジェクト方針で上書き可）

- UI は a11y を確保

- 禁止：秘密のハードコード、未使用コード放置

## 4. AI-TDD 基本線

1. 仕様の最小断面を文章で明示

2. 失敗するテストを追加

3. 最小実装で Green

4. リファクタ

5. PRで目的／影響／**テスト結果 or 実行ログ**を提示

## 5. PR ルール（ミニマム）

- タイトル: `[scope] one-line summary`

- 本文: 目的 / 変更点 / 影響範囲 / テスト結果（ログ/スクショ可）

- 必須: `lint && test` が **Green**（赤は Draft のまま）

## 6. セキュリティ

- `.env*` はコミット禁止（`.env.example` のみ更新）

- 外部鍵は Secrets / Vault を使用

- 外部APIは**例外処理とタイムアウト**を必須化

## 7. モノレポ運用（該当プロジェクトのみ）

- 近接優先：エージェントは「最も近い `AGENTS.md`」を採用

- 新規パッケージ：`packages/` に作成、依存追加は `--filter <pkg>`

- CI の最低条件：lint / test / typecheck（各リポで上書き可）

## 8. ツール連携（例）

- Gemini CLI：`AGENTS.md` を既定のコンテキストで読む

- Codex CLI：リポ直下の `AGENTS.md` を最初に参照する前提で作業

## 9. 付録（パッケージ用ミニ版）

> `packages/foo/AGENTS.md`

---

**関連**：レビュー観点チェックリスト → [`./coding-review-checklist.md`](./coding-review-checklist.md)
