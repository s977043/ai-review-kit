---
id: rr-upstream-review-policy-standard-001
name: 'Standard Review Policy for Upstream'
description: 'Applies standard AI review policy guidelines for upstream (design) phase reviews.'
phase: upstream
applyTo:
  - '**/*.md'
  - '**/*.adr'
  - '**/docs/**/*'
  - '**/design/**/*'
inputContext:
  - diff
outputKind:
  - findings
  - summary
modelHint: balanced
tags:
  - policy
  - upstream
  - design
  - architecture
severity: 'info'
---

## Goal / 目的

- 設計・ADR・ドキュメントの差分に対して、抜け・矛盾・リスクを早期に見つける。

## Non-goals / 扱わないこと

- 実装詳細を断定しない（設計の段階で決めるべきことだけに絞る）。
- “理想論” だけの一般論を連発しない（差分に紐づく指摘に限定する）。

## False-positive guards / 黙る条件

- 用語の表記ゆれなど軽微なものは “nit” に倒し、重要な設計判断の議論を邪魔しない。
- 前提が書かれていないだけで判断できない場合は、欠陥ではなく質問として扱う。

## Rule / ルール

- 指摘は差分に紐づける（根拠は `<file>:<line>`）。
- 優先する観点は「境界」「契約」「リスク」（API 契約、責務分割、認可、障害時ふるまい、移行手順）。
- 代替案を出すときは、トレードオフも 1 行で添える。

## Evidence / 根拠

- 変更されたセクション/図/箇条書きに紐づけて指摘する（差分内の行番号で示す）。

## Output / 出力

- 各指摘を 1 行で出力する: `<file>:<line>: <message>`
- `<message>` は日本語で簡潔に（目安: 200 文字以内）。
- 最大 8 件。指摘がなければ `NO_ISSUES` のみ。

## Heuristics / 判定の手がかり（例）

- ADR の決定事項と本文の記述が矛盾している/未更新
- API 契約（入力/出力、エラー、認可）が曖昧で実装ブレが出そう
- 障害時のふるまい（タイムアウト、リトライ、フォールバック、観測）が未定義
- 移行/ロールバック手順や互換性の方針が抜けている
