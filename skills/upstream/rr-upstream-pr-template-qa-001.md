---
id: rr-upstream-pr-template-qa-001
name: PRテンプレート品質チェック
description: PRテンプレートの必須項目（日本語記載、Diátaxis、検証コマンド、チェックリスト）が明確かを確認し、抜けや誤解を生む文言を指摘する
phase: upstream
applyTo:
  - '.github/pull_request_template.md'
  - '.github/PULL_REQUEST_TEMPLATE.md'
tags:
  - process
  - documentation
  - upstream
severity: minor
inputContext:
  - diff
outputKind:
  - findings
  - summary
modelHint: balanced
---

## Goal / 目的

- PR テンプレートが日本語記載・必須項目・検証コマンドを明確に示し、レビューフローでブレないようにする。

## Non-goals / 扱わないこと

- リポジトリ全体の運用ポリシーを決め直すこと。
- テンプレート外のドキュメント構成やCI設計を断定しない。

## False-positive guards / 抑制条件

- 表記ゆれや軽微な言い回しだけの場合は指摘しない（`NO_ISSUES`）。
- 英語版テンプレートが意図的に存在する場合は「日本語前提」への置換を強制しない（方針が明示されていれば黙る）。

## Rule / ルール

- 日本語で記載すべき旨が明確かを確認する（概要・レビューコメント）。
- Diátaxis 区分（Tutorial/How-to/Reference/Explanation）の選択と配置が分かりやすいか。
- 検証コマンド欄があり、例示が具体的か（`npm test`/`npm run lint` 等）。
- チェックリストが現在の運用に合っているか（applyTo 過剰/不足がないか）。
- アラートや注記は GitHub Alert 形式 `> [!NOTE]` などで目立つか。

## Output / 出力

- 日本語、`<file>:<line>: <message>` 形式。最大 5 件。問題なしは `NO_ISSUES`。
- `<message>` には `Finding`/`Impact`/`Fix` を含め簡潔に書く（200 文字以内）。

## 評価指標（Evaluation）

- 合格: 差分に基づき、言語・検証・チェックリスト・注記の抜け/曖昧さを指摘し、修正案を短く提示している。
- 不合格: 一般論のみ、差分無関係、根拠・Fix がない。

## 人間に返す条件（Human Handoff）

- 運用方針が不明（日本語/英語併用方針など）で判断が割れる場合は質問として返す。
