# Diff Review

差分レビュー用テンプレ。差分の正しさと**要件充足**は別物として両方見る。
重要度は `critical` / `major` / `minor` / `info`（`docs/review/output-format.md`）。
**差分に存在しないコードへの推測に基づく指摘は禁止**（`.claude/rules/review-core.md`）。

## Summary

- 変更の要点（1-2 行）:

## Changed Files

- 変更ファイルの一覧と各々の変更目的:

## Requirement Fit

- 差分は要件・受入条件を満たすか:

## Planned vs Actual Diff

- 計画（plan / 設計）と実差分の乖離。計画外の変更が紛れていないか:

## Existing Behavior Impact

- 既存挙動を壊していないか。後方互換は保たれるか:

## Code Quality

- 命名・責務・構造が既存設計に合っているか:

## Error Handling

- エラー処理は明示的か。握り潰し（silent catch）がないか:

## Security Review

- 認証認可・入力検証・信頼境界。秘密情報・PII・認証情報の混入がないか（該当なら強制 high 以上）:

## Data Safety Review

- データ破壊・不可逆変更・移行の安全性（該当なら強制 high 以上）:

## Test Review

- テストが追加/更新されたか。**適切な失敗を検知できるか**（テストの存在だけで安心しない）:

## Observability / Logging

- ログ・監視・アラート・運用影響が考慮されているか:

## Documentation Impact

- ドキュメント更新が必要か（実行例・SSoT 整合）:

## Unintended Changes

- 意図しない変更（フォーマット全書き換え・無関係ファイル・依存追加）がないか:

## Risk Level

- low / medium / high / critical:

## Decision

- approved / needs_revision / blocked / rejected（approve は根拠を添える）:

## Required Changes

- 通すために必要な修正:

## Suggested Follow-ups

- スコープ外だが別途追跡すべき事項:
