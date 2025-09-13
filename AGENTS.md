# AGENTS.md — AI Agent Guide (Template)

本リポジトリは **AI支援型TDD（AI-TDD）** を前提に、複数エージェント（Codex CLI / Gemini CLI など）が迷わず作業できる標準手順を定義します。人間向けREADMEと分離し、AI向けの実行ルール・検証・PR要件をここに集約します。

## 0. 原則（短く、正しく、検証可能に）
- 小さく変更 → テストで補装 → PR → CIでGreen確認 → レビュー
- 曖昧語を避け、**具体コマンド・期待出力**を書く
- 秘密情報を持ち込まない（.envは編集・コミット禁止）

## 1. スコープと構成
- 想定構成: `apps/*`, `packages/*`, `.github/workflows/*`
- 触ってよい: アプリ・ライブラリの実装、テスト、Lint/型修正、ドキュメント更新
- 触ってはダメ: `/docs/generated`, `**/*.lock`, `.env*`, `secrets/*`（存在する場合）

## 2. セットアップ & 共通コマンド（pnpm前提）
- 依存実装: `pnpm i`
- Lint: `pnpm lint`（失敗を残したままPRを作らない）
- 型検査: `pnpm tsc -b`
- テスト(全体): `pnpm test`
- パッケージ絞り込み: `pnpm turbo run test --filter <pkg>`

## 3. コーディング規約（事実上の規約＝設定ファイル）
- TypeScript: strict を維持
- ESLint/Prettier: 設定に従う（ファイルが規約の“唯一の真実”）
- 命名: 変数/関数=camelCase, 型/コンポーネント=PascalCase
- UI: アクセシビリティ（ラベル/ARIA）を必須化
- 禁止: ハードコード秘密、宽容なmutable state、未使用コードの放置

## 4. AI-TDD 基本線
1) 仕様の最小斷面を文章で明示  
2) 失敗するテストを追加  
3) 最小実装でGreen  
4) リファクタ  
5) PRで目的/影響/テスト結果を提示

## 5. PR ルール
- タイトル: `[scope] one-line summary`
- 本文: 目的 / 変更点 / テスト結果ログ / 影響範囲 / スクショ or 動画
- 必須条件: `pnpm lint && pnpm test` が **Green**
- CIが赤のPRは Draft のままにする

## 6. セキュリティ
- `.env*` はコミット禁止。必要なら `.env.example` のみ更新
- 外部鍵は GitHub Actions Secrets / Vault を使用
- 外部API呼び出しは **例外処理とタイムアウト** を必頂化

## 7. モノレポ運用
- 近接優先: エージェントは「最も近い `AGENTS.md`」を採用
- 新規パッケージ: `packages/` に作成、依徝追加は `--filter <pkg>` を付与
- CIは lint/test/typecheck を最低限の成功条件にする

## 8. ツール連携（例）
- Gemini CLI: 設定で `AGENTS.md` を新たのコンテキストとして読み込む
- Codex CLI: リポジトリ直下の `AGENTS.md` を最初に参照する前提で作業

## 9. 付録（パッケージ用ミニ版サンプル）
> `packages/foo/AGENTS.md`
