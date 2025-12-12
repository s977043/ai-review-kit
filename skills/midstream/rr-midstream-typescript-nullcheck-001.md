---
id: rr-midstream-typescript-nullcheck-001
name: TypeScript Null Safety Guardrails
description: Enforce null/undefined safety for changed TypeScript code and suggest safer patterns.
phase: midstream
applyTo:
  - '**/*.ts'
  - '**/*.tsx'
tags: [typescript, type-safety, midstream]
severity: major
inputContext: [diff, fullFile]
outputKind: [findings, actions]
modelHint: balanced
dependencies: [code_search]
---

## Rule / ルール

- 非同期・外部入力・オプショナル値には null/undefined ガードを設ける。
- 非 null アサーション（`!`）や型アサーション（`as Foo`）に頼らず安全な分岐/early return を使う。
- ユニオン型は網羅的にハンドリングし、`never` 到達をチェックする。

## Heuristics / 判定の手がかり

- `foo!` や `as Type` で未定義かもしれない値を強制している。
- API レスポンス/環境変数/クエリパラメータをノーチェックで使用。
- `switch`/`if` でユニオン型の全ケースをカバーしていない（defaultで握りつぶし）。
- Promise 戻りを `await` せずに使い、`undefined` アクセスの可能性がある。

## Good / Bad Examples

- Good: `if (!value) return err('missing value');` のように early return でガード。
- Bad: `value!.length` のような非 null アサーション。
- Good: `switch (state.kind)` で各 kind を列挙し、`default: assertNever(state)` を置く。

## Actions / 改善案

- 外部入力やオプショナル値に対して null/undefined チェックを追加し、早期 return/throw で制御を明確化する。
- 非 null アサーションを排除し、undefined を許容する型定義やパーサーを導入する。
- ユニオン型を網羅する switch/if を書き、`assertNever` などで漏れを検知する。
