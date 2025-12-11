---
id: rr-downstream-flaky-test-001
name: Flaky Test Risk Check
description: Detects patterns that make tests flaky and proposes stabilization steps.
phase: downstream
applyTo:
  - '**/*.test.ts'
  - '**/*.test.js'
  - '**/*.spec.ts'
  - '**/*.spec.js'
  - 'tests/**/*.ts'
  - 'tests/**/*.js'
tags: [tests, reliability, flakiness, downstream]
severity: major
inputContext: [diff]
outputKind: [findings, actions, summary]
modelHint: balanced
dependencies: [test_runner]
---

## Rule / ルール

- テストを決定的にし、実行順や環境依存を避ける。
- タイミング依存（sleep/timeout）、乱数、時刻依存のまま放置しない。
- ネットワークや外部サービス呼び出しはモック/スタブに置き換える。

## Heuristics / 判定の手がかり

- `setTimeout`/`sleep`/`waitFor` で待ち時間を固定している。
- `Math.random()`/`Date.now()`/`new Date()` をシード・固定値なしで使っている。
- ネットワーク/DB/ファイル I/O への直接依存がある（モックが無い）。
- 並列実行で共有状態を操作している、またはテスト順序に依存している。
- 未 `await` の Promise が残っている、cleanup が `afterEach` で行われていない。

## Good / Bad Examples

- Good: `vi.useFakeTimers(); jest.runAllTimers();` でタイマーを制御。
- Good: `Math.random = () => 0.42;` などで乱数を固定。
- Bad: `await sleep(1000);` に依存するテスト。
- Bad: 実際の外部 API を呼ぶ統合テストをユニットテストに混在させる。

## Actions / 改善案

- タイマー/日時/乱数をモックし、シードを固定する。
- ネットワーク・DB・外部サービスをモック/スタブ化し、リトライやバックオフをテストしない。
- 共有状態を隔離し、`beforeEach`/`afterEach` でクリーンアップする。
- 並列実行に耐えるようテストデータを分離し、副作用を最小化する。
