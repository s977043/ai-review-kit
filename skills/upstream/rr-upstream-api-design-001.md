---
id: rr-upstream-api-design-001
name: API Design Consistency
description: Ensure API design follows RESTful naming and consistent conventions.
phase: upstream
applyTo:
  - '**/api/**'
  - '**/routes/**'
tags: [api, design, upstream]
severity: major
inputContext: [diff, adr]
outputKind: [findings, summary, actions]
dependencies: [repo_metadata]
---

## Rule / ルール

- エンドポイントはリソース指向の RESTful 命名に従う（動詞を避ける）
- ステータスコードとエラーレスポンスを一貫させる
- バージョニングや認可要件を明示する

## Heuristics

- `/getUser`, `/doAction` のような動詞ベースのパス
- 4xx/5xx のステータスやエラー構造がエンドポイントごとに不揃い
- 認可・バージョンの記載が ADR/設計と乖離

## Good / Bad Examples

- Good: `/users/{id}`, `/projects/{id}/members`
- Bad: `/fetchUser`, `/doLoginNow`
- Good: エラーボディに code/message/detail を含めて統一

## Actions / 改善案

- パスをリソース指向にリネームし、コレクション/単体の区別を明確にする
- エラー応答を共通スキーマに合わせる
- ADR/設計で定義した認可・バージョン要件をエンドポイント仕様に反映する

## Non-goals / 扱わないこと

- API ゲートウェイやルーティング基盤の再設計。
- 既存クライアントの破壊的変更に関する移行計画。
- 実装レベルのパフォーマンス最適化。

## False-positive guards / 黙る条件

- ルーティングの追加がなく、コメントやドキュメントのみの変更。
- 既存の API ガイドラインに完全準拠している差分。
- 自動生成された API 定義の更新のみで、設計意図に変化がない。
