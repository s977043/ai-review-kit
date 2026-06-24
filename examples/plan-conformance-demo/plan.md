# Plan: Add input validation to GET /api/users/:id

承認済みの実装プランです。River Review はこのプランをレビューの基準として扱います。

## Goal

`GET /api/users/:id` に入力バリデーションを追加し、不正な `id` を安全に弾く。

## Requirements

1. **入力バリデーションを追加する**
   - `id` は正の整数のみ許可する。
2. **既存 API のレスポンス互換性を維持する**
   - 正常時のレスポンス形式 `{ user: { id, name } }` は変更しない。
3. **エラー時は HTTP 400 を返す**
   - バリデーション失敗時は `400 Bad Request` と `{ error: "invalid id" }` を返す。

## Test requirements

- `id` が負数・ゼロ・非整数の場合に 400 を返す境界値テストを追加する。
- 既存の正常系テスト（`{ user: ... }` 形式）が引き続き通ることを確認する。

## Out of scope

- 認証・認可の変更
- レスポンス形式そのものの再設計
