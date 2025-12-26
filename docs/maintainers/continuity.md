---
id: continuity
---

Goal (success criteria included):

- PR #204 のレビュー指摘（baseUrl 設定重複の解消、Diátaxis リマインド対応）を反映し、セルフレビュー後プッシュする。

Constraints / Assumptions:

- レポジトリの AGENTS.md ルールに従う（npm test / npm run lint 実施）。
- Ledger を主要イベント前後で更新する。

Key decisions:

- docs ルーティング設定の単一ソース化を行う（config の計算結果を共有して重複を排除）。

State:
Done:

- 直近のドキュメントルーティング改善はコミット済み（PR #204 参照）。
- PR #204 の CI は全成功。Diátaxis リマインドと Gemini から baseUrl 重複指摘あり。
- docsRouteBasePath を customFields で公開し、ホームリダイレクトで共有利用するよう重複を解消。
- PR 本文に Diátaxis (Guide/How-to) を明記し、テスト・lint・build を再実行。
  Now:
- コメント返信内容をまとめて報告する。
  Next:
- 追加のレビューフィードバックが来た場合に対応する。

Open questions:

- アプリ側（Next.js 側）の rewrite 適用状況は別リポジトリ管理のため不明（UNCONFIRMED）。

Working set (files / ids / commands):

- docs/maintainers/continuity.md; PR #204（Improve docs routing and link quality gates）
