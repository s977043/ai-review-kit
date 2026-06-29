---
id: 'logging-observability'
name: Logging and Observability Guard
description: Ensure code changes keep logs/metrics/traces useful for debugging failures and regressions.
version: 0.1.0
category: midstream
phase: midstream
applyTo:
  - 'src/**/*.{ts,tsx,js,jsx,mjs,cjs}'
  - 'app/**/*.{ts,tsx,js,jsx,mjs,cjs}'
  - 'lib/**/*.{ts,tsx,js,jsx,mjs,cjs}'
  - 'packages/**/*.{ts,tsx,js,jsx,mjs,cjs}'
tags:
  - observability
  - logging
  - reliability
  - midstream
severity: minor
inputContext:
  - diff
outputKind:
  - findings
  - actions
modelHint: balanced
dependencies:
  - tracing
  - code_search
---

## Pattern declaration

Primary pattern: Reviewer
Secondary patterns: Inversion
Why: ログ・メトリクス・トレースの品質をチェックリスト型で評価するが、可観測性に無関係な変更では実行不要

## Guidance

- Flag swallowed exceptions or catch blocks without logging/propagation.
- Require structured logs/metrics/traces with request IDs and minimal PII on new error paths.
- Ensure retries/fallbacks/cache branches emit signals for hit/miss/attempt counts.
- Highlight noisy or contextless logs that hinder debugging.

## Non-goals

- ログ基盤の選定や詳細設計の議論は避ける。

## Pre-execution Gate / 実行前ゲート

このスキルは以下の条件がすべて満たされない限り`NO_REVIEW`を返す。

- [ ] 差分にアプリケーションコード（`src/`, `lib/`, `*.js`, `*.mjs`, `*.ts`, `*.tsx`）の変更が含まれている
- [ ] 差分にエラーハンドリング、ログ出力、リトライ/フォールバック/キャッシュのいずれかに関連するコードが含まれている
- [ ] inputContextにdiffが含まれている

ゲート不成立時の出力: `NO_REVIEW: rr-midstream-logging-observability-001 — 可観測性に関連するアプリケーションコード変更が検出されない`

## False-positive guards

- テスト用の意図的な無視や既に文脈付きで再 throw している場合は指摘しない。
