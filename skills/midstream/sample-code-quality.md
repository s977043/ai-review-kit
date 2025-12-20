---
id: rr-midstream-code-quality-sample-001
name: 'Sample Code Quality Pass'
description: 'Checks common code quality and maintainability risks.'
phase: midstream
applyTo:
  - 'src/**/*.ts'
  - 'src/**/*.js'
  - 'src/**/*.py'
inputContext:
  - diff
outputKind:
  - findings
  - actions
modelHint: balanced
dependencies:
  - code_search
tags:
  - sample
  - style
  - maintainability
  - midstream
severity: 'minor'
---

## Goal / 目的

- 差分に対して、可読性・保守性・エラー処理のリスクを “薄く” 拾うサンプルです。

## Non-goals / 扱わないこと

- 重要度の低いスタイル指摘を大量に出さない。
- 差分外のリファクタ方針を断定して押し付けない。

## False-positive guards / 抑制条件

- 変更がコメント/整形のみで、実質的な挙動変更がない場合は深入りしない。

## Rule / ルール

- 命名、責務、重複、不要コード、例外処理の不足など、保守性を落とす要因を優先する。
- 指摘は差分に紐づけ、必要なら “次の一手” を 1 つだけ添える。

## Output / 出力

- `<file>:<line>: <message>` 形式で 1 行ずつ（日本語、短く）。

## 評価指標（Evaluation）

- 合格基準: 指摘が差分に紐づき、根拠と次アクションが説明されている。
- 不合格基準: 差分と無関係な指摘、根拠のない断定、抑制条件の無視。

## 人間に返す条件（Human Handoff）

- 仕様や意図が不明確で解釈が分かれる場合は質問として返す。
- 影響範囲が広い設計判断やトレードオフは人間レビューへ返す。
