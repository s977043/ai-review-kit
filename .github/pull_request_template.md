## 背景 / Goal

- [ ] 問題の概要と目的を1-2行で記載
- [ ] 仕様・要件・外部リンクがあれば添付

## 変更点 / Summary

- [ ] 主な変更内容を箇条書き（スキーマ・チェックリスト・ドキュメントなど）
- [ ] 追加/更新したCIやスクリプトがあれば記載

## 影響範囲 / Impact

- [ ] 対象: ドキュメント / スキーマ / チェックリスト / ワークフロー / その他
- [ ] エージェント利用者が追従すべき手順があれば明記

## 実行結果 / Logs

```bash
pnpm run agents:validate
# 追加で実行したコマンド（例: pnpm run lint, pnpm test など）
```

## チェックリスト / Checklist

- [ ] `pnpm run agents:validate`
- [ ] 必要なLintやテスト (`pnpm run lint`, `pnpm test` など) がGreen
- [ ] `docs/agents.md` と `README.md` を更新済み
- [ ] `.github/ai-review/checklists/` の更新内容を自己レビュー済み
- [ ] 影響範囲のドキュメント・利用者通知を準備
