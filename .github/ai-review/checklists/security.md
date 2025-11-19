# Security Checklist — PocketEitan

PocketEitanの学習データとSupabase基盤を安全に保つためのレビュー観点です。`agents/examples/pocket-eitan.agent.yaml` と `.github/security-gauntlet.md` を参照し、以下を確認してください。

## 1. ベースライン検査

- [ ] `pnpm audit --audit-level moderate` の実行結果がGreen
- [ ] 依存関係の差分が依存性レビュー（actions/dependency-review-action）で承認できる状態
- [ ] TypeScript strict mode・ESLintでセキュリティ警告が発生していない
- [ ] 秘密情報やAPIキーがコード・テスト・ログに追加されていない

## 2. 認証・認可

- [ ] Supabase Row Level Security (RLS) が影響を受けない変更である
- [ ] Supabaseトークンの保存・更新フローに破綻がない
- [ ] APIやユースケースで権限チェックが欠落していない
- [ ] プロフィールや進捗など学習データが他ユーザーへ漏洩しない

## 3. 入力検証とエラーハンドリング

- [ ] Zod / schema バリデーションが新しい入力パスでも実行されている
- [ ] `handleApiError` で例外が正しく捕捉され、攻撃者にヒントを与えないレスポンスになっている
- [ ] SQLインジェクションやN+1などの危険なクエリパターンがない
- [ ] ファイルサイズ・文字列長などの境界値が制御されている

## 4. 通信・データ保護

- [ ] API / Service Worker / Supabase 通信がHTTPS前提であることを確認
- [ ] LocalStorage/IndexedDB に機密情報を保存していない
- [ ] オフライン同期時に衝突解決や再送の整合性が担保されている
- [ ] ログおよびアナリティクスに個人特定情報を出力していない

## 5. 運用と監視

- [ ] セキュリティログや監査ログの記録が途切れない
- [ ] 障害やインシデント時のロールバック手順が明確
- [ ] 追加した依存・設定が `docs/agents.md` などのドキュメントに反映されている

> **Note:** クリティカルまたはHighリスクの指摘が残る場合はマージを拒否し、代替案やhotfix計画を提示してください。
