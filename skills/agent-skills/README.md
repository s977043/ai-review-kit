---
title: Agent Skills Packages
---

このディレクトリは、Agent Skills 仕様の「スキル・パッケージ」を置くための領域です。
River Reviewer の `skills/**/*.md` とは別系統として扱い、`SKILL.md` と `references/` を中心に構成します。

## 構成ルール

- 1 スキル = 1 フォルダ（例: `skills/agent-skills/architecture-review/`）
- 必須: `SKILL.md`（YAML frontmatter + 本文）
- 推奨: `references/`（詳細手順や根拠、長文を分離）

## 収録スキル（初期雛形）

- `architecture-review/`: 変更の全体設計・境界・責務のチェック
- `code-quality/`: 可読性・保守性の基本チェック
- `test-coverage/`: 変更に対するテスト不足の検知
