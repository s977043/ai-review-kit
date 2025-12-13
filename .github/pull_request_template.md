# 🌊 River Reviewer Pull Request

Flow your changes from Upstream to Midstream to Downstream with clear validation.

## Overview / 説明

- [ ] Briefly describe what's changing and why (1-2 lines)（このPRの変更内容を簡潔に説明してください）
- Primary phase focus: Upstream / Midstream / Downstream

## Flow Consistency

- [ ] Upstream: design/requirements updated and linked
- [ ] Midstream: implementation matches the intended flow
- [ ] Downstream: tests/QA steps cover the change
- [ ] Schema Validation passed? (`schemas/skill.schema.json`)
- [ ] Skill file structure validated? (`skills/*` follows schema and naming)

## Documentation / ドキュメント

Does this PR change or add documentation?

- [ ] No docs change（ドキュメント変更なし）
- [ ] Yes, docs are changed/added（ドキュメントの追加・変更あり）

If yes, please select the Diátaxis type for the main document in this PR (choose ONE):

- [ ] Tutorial（チュートリアル / 入門用レッスン）
- [ ] How-to guide（ハウツー / 特定のタスク達成の手順）
- [ ] Reference（リファレンス / 仕様や事実の一覧）
- [ ] Explanation（解説 / 背景や設計思想）

Diátaxis compliance / Diátaxis 準拠チェック:

- [ ] This document clearly focuses on a single Diátaxis type.
- [ ] The file is placed under the corresponding `pages/` section.
- [ ] The content matches the chosen type (for example, no long conceptual explanation in a how-to guide).

Language / 言語:

- [ ] Japanese（日本語・標準）
- [ ] English（英語 / `.en.md` ファイル）

## Validation & Evidence

List commands and logs that prove the change is river-safe.

```bash
# e.g.
npm run agents:validate
npm test
```

## Checklist / チェックリスト

- [ ] Added or updated tests related to the changes.（変更内容に関連するテストを追加・修正しました。）
- [ ] Verified that tests pass.（テストが通過することを確認しました。）
- [ ] Updated documentation or notes if necessary.（追加のドキュメントやノートが必要な場合は更新しました。）

### Skill Changes（スキル変更がある場合）

- [ ] `applyTo` が過剰に広くない（狙いが説明できる）
- [ ] 誤検知ガード（黙る条件）と Non-goals がある
- [ ] 指摘文が短く、次の行動に結びつく
- [ ] `npm run skills:validate` を実行した

## Related Issues

- Closes #
- Related #

## Reviewer Notes

Context, roll-out risks, or follow-up tasks for reviewers.
