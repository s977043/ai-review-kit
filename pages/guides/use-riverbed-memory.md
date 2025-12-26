# Riverbed Memory を使用する

Riverbed Memory は過去のレビューコンテキストを保存し、将来のフローの一貫性を保ちます。

## 手順

1. 決定の記録: Upstream 設計の選択については PR の説明に短いメモを追加し、関連する場合にスキルの指示からリンクします。
2. シグナルの永続化: 承認されたレビュー結果（例: `logs/` やデータベース層）をスキル ID とフェーズをキーとして保存します。
   例えば、`logs/review_outcomes.json` を以下のように保持します:

   ```json
   {
     "skill-123": {
       "phase": "upstream",
       "outcome": "approved",
       "notes": "Design aligns with upstream architecture."
     },
     "skill-456": {
       "phase": "midstream",
       "outcome": "approved",
       "notes": "Code meets performance requirements."
     }
   }
   ```

3. コンテキストの再利用: 新しいスキルを作成する際、重複した警告や矛盾したガイダンスを避けるために、以前の決定を参照します。
4. 古いメモリの期限切れ: 定期的なリズム（例: 毎月）を設定して、古い決定を整理し、前提条件を更新します。

## グッドプラクティス

- メモリエントリは小さく、アクション指向（何が変わったか、なぜか、そしてフェーズ）に保ちます。
- 自動化ツールがレビューアに情報を注入できるように、構造化されたフォーマット（JSON/YAML）を推奨します。
