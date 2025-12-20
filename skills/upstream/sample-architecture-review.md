---
id: rr-upstream-architecture-sample-001
name: 'Sample Architecture Consistency Review'
description: 'Checks design/ADR docs for consistency and missing decisions.'
phase: upstream
applyTo:
  - 'docs/architecture/**/*.md'
  - 'docs/adr/**/*.md'
tags:
  - sample
  - design
  - architecture
  - upstream
severity: 'minor'
inputContext:
  - diff
outputKind:
  - findings
  - summary
  - questions
  - actions
modelHint: balanced
dependencies:
  - adr_lookup
---

## Goal / 目的

- ADR/設計ドキュメントの差分から、矛盾・抜け・前提不足を “薄く” 拾うサンプルです。

## Non-goals / 扱わないこと

- 実装詳細の断定や、根拠のない推測で断言しない。

## False-positive guards / 抑制条件

- 判断材料が不足している場合は、欠陥ではなく質問として扱う。

## Rule / ルール

- ADR と本文の整合（決定事項、採用理由、却下案、影響範囲）を確認する。
- 境界（API/データ契約/障害時ふるまい）が曖昧なら指摘する。
- 指摘は差分に紐づけ、ファイル/セクション参照を添える。

## Output / 出力

- `<file>:<line>: <message>` 形式で 1 行ずつ（日本語、短く）。

## 評価指標（Evaluation）

- 合格基準: 指摘が差分に紐づき、根拠と次アクションが説明されている。
- 不合格基準: 差分と無関係な指摘、根拠のない断定、抑制条件の無視。

## 人間に返す条件（Human Handoff）

- 仕様や意図が不明確で解釈が分かれる場合は質問として返す。
- 影響範囲が広い設計判断やトレードオフは人間レビューへ返す。
