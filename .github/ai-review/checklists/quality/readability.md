# Quality Checklist—Readability & Documentation (PocketEitan)

PocketEitanのPRは日本語で説明され、学習アプリとしてのUXを重視します。以下の観点でレビューを実施してください。

## 1. 目的とスコープ

- [ ] PR本文に目的・変更点・影響範囲・テスト結果が明記されている
- [ ] 1PR = 1目的であり、無関係な機能が混在していない
- [ ] スクリーンショットやログが必要な場合は添付されている

## 2. コード可読性

- [ ] 関数・コンポーネントは単一責務で、意図が名前とテストから理解できる
- [ ] マジックナンバー/文字列は `const` や設定ファイルに切り出されている
- [ ] コメントは「何をしたか」ではなく「なぜそうするか」を説明している
- [ ] Storybook / Playwright などUI確認の証跡が整っている

## 3. ドキュメント更新

- [ ] README / docs / Swagger / Storybook が差分に合わせて更新されている
- [ ] `docs/agents.md` に新しいエージェントや手順が追記されている
- [ ] リンク切れや古い説明が残っていない

## 4. UX・アクセシビリティ

- [ ] フォーカス制御とARIA属性が正しく設定されている
- [ ] エラー／空状態／ローディング表示がユーザーにとってわかりやすい
- [ ] 中学生向けのトーンでフィードバック文言が書かれている

## 5. 品質証跡

- [ ] `pnpm lint && pnpm test` のログがPRに貼られている
- [ ] 重大な指摘に対して再現手順と解決策が整理されている
- [ ] 大きな変更には @mention や CODEOWNERS に基づくレビュアーがアサインされている

> **Reminder:** 仕上げに `agents/examples/pocket-eitan.agent.yaml` の `guidelines.documentation` と `automation.ciWorkflows` をクロスチェックし、見落としがないか確認しましょう。
