# Design Review

設計レビュー用テンプレ。既存設計との整合を最優先に見る。
差分外の盲点は `skills/upstream/pre-mortem` / `skills/agent-skills/adversarial-review` を併用。

## Summary

- 何の設計をレビューしたか（1-2 行）:

## Existing Design Fit

- 既存アーキテクチャ・契約・ADR・既存パターンと整合するか（最優先）:

## Responsibility Boundaries

- 責務分離は明確か。1コンポーネントに責務を詰め込みすぎていないか:

## Data Flow

- データの流れ・所有権・状態遷移は追えるか:

## Error Handling

- エラーパス・失敗時の挙動・リカバリは定義されているか:

## Security

- 認証認可・入力検証・信頼境界・秘密情報の扱い（該当なら強制 high 以上）:

## Performance

- 実行効率・リソース・スケーラビリティに致命的な問題はないか:

## Testability

- テスト可能な単位に分かれているか。副作用は注入できるか:

## Maintainability

- 将来の変更・デバッグのしやすさ:

## Scalability

- 将来の拡張に耐えるか（過小設計でないか）:

## Dependency Impact

- 追加する依存は妥当か。取り除けないか:

## Alternatives Considered

- 検討した代替案と、この設計を選んだ理由:

## Overengineering Check

- 現要件に対して過剰でないか（YAGNI）:

## Rollback Plan

- 問題時に安全に戻せるか:

## Risk Level

- low / medium / high / critical:

## Decision

- approved / needs_revision / blocked / rejected（根拠を添える）:

## Required Changes

- 通すために必要な修正・確認:
