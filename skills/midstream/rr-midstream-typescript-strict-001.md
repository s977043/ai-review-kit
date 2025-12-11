---
id: rr-midstream-typescript-strict-001
name: TypeScript Strictness Guard
description: Enforce TypeScript strictness by reducing any/unsafe assertions and ensuring null handling.
phase: midstream
applyTo:
  - '**/*.ts'
  - '**/*.tsx'
tags: [typescript, type-safety, midstream]
severity: major
inputContext: [diff, fullFile]
outputKind: [findings, actions]
dependencies: [code_search]
---

## Rule / ルール

- `any` の使用や無制限の型アサーションを最小化する
- null/undefined を明示的に扱い、ガード節を追加する
- 型の流れが不明な箇所には型エイリアス/インターフェースを付ける

## Heuristics

- `any`, `as unknown as`, `as any` などが新たに追加されている
- 非 null アサーション `!` が多用されている
- 関数戻り値や外部入力が `any` や `object` で受け取られている

## Good / Bad Examples

- Good: `type User = { id: string; name: string };`
- Bad: `const user: any = getUser();`
- Good: `if (!value) return;` で null をガード
- Bad: `value!.doSomething()` で非 null アサーション連発

## Actions / 改善案

- `unknown` で受けて型ガード関数を追加する
- null チェックをガード節で追加し、早期 return を使う
- 型アサーションの代わりに型定義や Zod 等でスキーマを導入する
