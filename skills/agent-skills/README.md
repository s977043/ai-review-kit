---
title: Agent Skills Packages
---

このディレクトリは、Agent Skills 仕様の「スキル・パッケージ」を置くための領域です。
River Reviewer の `skills/**/*.md` とは別系統として扱い、`SKILL.md` と `references/` を中心に構成します。

## 構成ルール

- 1 スキル = 1 フォルダ（例: `skills/agent-skills/architecture-review/`）
- 必須: `SKILL.md`（YAML frontmatter + 本文）
- 推奨: `references/`（詳細手順や根拠、長文を分離）

## 収録スキル

- `architecture-review/`: 変更の全体設計・境界・責務のチェック
- `code-quality/`: 可読性・保守性の基本チェック
- `test-coverage/`: 変更に対するテスト不足の検知
- `code-review/`: PR 向けのセキュリティ・性能・品質・テスト観点レビュー
- `code-refactoring/`: 挙動を変えずに設計を整えるための手順ガイド
- `qa-regression/`: Playwright を用いた主要フローの回帰テスト設計と実行
- `code-documentation/`: 目的や使い方を短時間で伝えるドキュメント整備ガイド
- `webapp-testing/`: Playwright を用いた Web アプリケーションの対話・テストツールキット
- `agentcheck-code-review/`: AgentCheck ベースでローカルリポジトリを走査するコードレビュー
