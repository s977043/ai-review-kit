---
description: Issue 提案前にコードベースを調査し、既存実装の有無を確認する
argument-hint: '<issue title or description>'
allowed-tools: Bash(rg:*), Bash(git log:*), Bash(gh pr list:*), Bash(gh pr view:*), Bash(gh issue list:*), Bash(gh issue view:*)
---

Issue 「$ARGUMENTS」を作成する前に、既存実装の有無を確認してください。

## 調査手順

1. **キーワード抽出**: Issue タイトル・説明から検索キーワードを2-4個抽出
2. **コードベース探索**: 以下のディレクトリで関連ファイルを検索
   - `src/lib/` の既存モジュール
   - `schemas/` の既存スキーマ
   - `scripts/` の既存スクリプト
   - `tests/` の既存テスト
   - `runners/` の既存ランナー
3. **Git 履歴確認**: `git log --all --oneline | grep -i "<keyword>"` で関連コミット（複数単語対応のためクォート）
4. **マージ済み PR 確認**: `gh pr list --state merged --search <keyword>`
5. **既存 Issue 確認**: `gh issue list --state all --search <keyword>`
6. **本文の裏取り**: 本文に書く数値・引用・前提は一次ソース（実ファイル・実コマンド出力・API 応答・原典）で裏取りし、参照したソースを本文へ明記する

## 判定

調査結果に基づいて以下のいずれかで応答:

### A. 既に実装済み

実装済みファイルと関連 PR を提示し、Issue は作成しない。ユーザーに「既に実装済みです。該当機能は以下に存在します」と報告。

### B. 部分的に実装済み

既存実装と未実装部分を明示し、Issue のスコープを「既存 Y の拡張: X」に修正して提案。

### C. 完全に未実装

Issue 作成の根拠となる調査結果を報告し、ユーザーの承認後に Issue を作成。

## 禁止事項

- 調査を省略して Issue を作成してはならない
- `src/lib/`, `schemas/`, `scripts/` のいずれかの探索を省略してはならない
- 「多分ない」という推測で Issue を作成してはならない
