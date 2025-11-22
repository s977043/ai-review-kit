# Language Checklist—TypeScript / JavaScript (PocketEitan)

PocketEitanは Next.js + TypeScript (strict) を採用しています。以下の観点で、差分が規約に準拠しているかを確認してください。

## 1. 型安全性

- [ ] `any` の導入や型穴埋め (`as unknown as`) が増えていない
- [ ] DTOとDomAInモデルの型が混在せず、責務ごとに分離されている
- [ ] `Result<T, E>` や Value Object など既存パターンを再利用している
- [ ] APIレスポンスは Zod / OpenAPI と同期している

## 2. Clean Architecture 層分離

- [ ] `apps/web/src/domain` が `infrastructure` や `pages/api` に依存していない
- [ ] application層はリポジトリインターフェース越しに副作用へアクセスしている
- [ ] UIコンポーネントがビジネスロジックを含まず、props/handlerのみに責任を持つ
- [ ] RepositoryFactory の利用により依存注入が保たれている

## 3. テストファースト

- [ ] 失敗するテストが追加されてから実装が行われている（AI-TDDのRed→Green→Refactor）
- [ ] 新しいユースケースやコンポーネントに対して Vitest / Playwright / contract test が揃っている
- [ ] テストが副作用を持たず、決定的に再現できる
- [ ] `pnpm lint && pnpm test` の結果がPRに記録されている

## 4. 実装スタイル

- [ ] camelCase（関数・変数）、PascalCase（型・コンポーネント）の命名規約に従っている
- [ ] 関数は単一責務で20行前後に収まっている（複雑ならユーティリティ化）
- [ ] 非同期処理は `async/await` で統一し、例外ハンドリングを明示する
- [ ] i18n / a11y を考慮し、UIテキストは適切なラベル・ARIA属性を持つ

## 5. オフライン・PWA考慮

- [ ] Service Worker や同期フローの変更が offline-first を壊していない
- [ ] IndexedDB / LocalStorage の同期が Supabase と矛盾しない
- [ ] キャッシュ更新やバージョン差分の移行が用意されている

> **ヒント:** 迷った場合は `agents/examples/pocket-eitan.agent.yaml` の `tooling` と `agents` セクションを参照し、どのエージェント指示に従えば良いか確認してください。
