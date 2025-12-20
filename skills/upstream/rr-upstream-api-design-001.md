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

## False-positive guards / 抑制条件

- ルーティングの追加がなく、コメントやドキュメントのみの変更。
- 既存の API ガイドラインに完全準拠している差分。
- 自動生成された API 定義の更新のみで、設計意図に変化がない。

## 評価指標（Evaluation）

- 合格基準: 指摘が差分に紐づき、根拠と次アクションが説明されている。
- 不合格基準: 差分と無関係な指摘、根拠のない断定、抑制条件の無視。

## 人間に返す条件（Human Handoff）

- 仕様や意図が不明確で解釈が分かれる場合は質問として返す。
- 影響範囲が広い設計判断やトレードオフは人間レビューへ返す。
