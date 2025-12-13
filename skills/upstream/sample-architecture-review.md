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

## False-positive guards / 黙る条件

- 判断材料が不足している場合は、欠陥ではなく質問として扱う。

## Rule / ルール

- ADR と本文の整合（決定事項、採用理由、却下案、影響範囲）を確認する。
- 境界（API/データ契約/障害時ふるまい）が曖昧なら指摘する。
- 指摘は差分に紐づけ、ファイル/セクション参照を添える。

## Output / 出力

- `<file>:<line>: <message>` 形式で 1 行ずつ（日本語、短く）。
