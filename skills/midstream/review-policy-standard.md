---
id: rr-midstream-review-policy-standard-001
name: 'Standard Review Policy for Midstream'
description: 'Applies standard AI review policy guidelines for midstream (implementation) phase reviews.'
phase: midstream
applyTo:
  - 'src/**/*.ts'
  - 'src/**/*.js'
  - 'src/**/*.py'
  - 'src/**/*.go'
  - 'src/**/*.java'
  - 'src/**/*.rb'
  - 'lib/**/*'
  - 'app/**/*'
inputContext:
  - diff
  - fullFile
outputKind:
  - findings
  - summary
  - actions
modelHint: balanced
dependencies:
  - code_search
tags:
  - policy
  - midstream
  - implementation
  - code-quality
severity: 'info'
---

## Goal / 目的

- 実装フェーズの差分に対して、バグ・安全性・保守性のリスクを短く指摘する。

## Non-goals / 扱わないこと

- 差分にないコードや仕様を断定しない（推測は “可能性” として扱う）。
- 重要度の低い “nit” を濫発しない（本質的なリスクを優先する）。
- プロジェクトの前提が不明なまま大規模リファクタを押し付けない。

## False-positive guards / 黙る条件

- 変更がコメント・フォーマットのみで、挙動変更が見当たらない場合は深入りしない。
- リスクが不確実で根拠が薄い場合は、断定ではなく質問として扱う。

## Rule / ルール

- 差分に紐づく指摘だけを出す（根拠は `<file>:<line>`）。
- 優先度は「壊れる/漏れる/回復できない」ものから（例: 入力検証不足、例外握りつぶし、認可漏れ、型安全性の破壊）。
- 可能なら “次の一手” を最小で添える（過剰な提案は避ける）。

## Evidence / 根拠

- 指摘は必ず `<file>:<line>` で追える形にする。
- 差分外の推測に依存する場合は、その旨を明示する。

## Output / 出力

- 各指摘を 1 行で出力する: `<file>:<line>: <message>`
- `<message>` は日本語で簡潔に（目安: 200 文字以内）。
- PR の本文（説明）と PR コメント（レビューコメント）は日本語で書く。
- 最大 8 件。指摘がなければ `NO_ISSUES` のみ。

## Heuristics / 判定の手がかり（例）

- I/O・外部 API のエラー処理不足（タイムアウト、例外伝播、再試行の意図が不明）
- 入力バリデーション不足（URL/ボディ/環境変数/外部レスポンスのノーチェック使用）
- 例外の握りつぶし（ログ無し、戻り値で隠蔽、cause が失われる）
- 競合・リソースリーク（接続/ファイルハンドルの close 忘れ、共有状態の競合）
- ハードコード値の増加（環境差異で壊れる設定値）
