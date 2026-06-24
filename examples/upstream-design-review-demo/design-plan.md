# Design Plan: Outbound Webhook Delivery

承認待ちの設計プランです。River Review はこのプランを upstream レビューの対象として扱います。

## Goal

イベント発生時に、ユーザーが登録した URL へ HTTP POST で Webhook を配信する機能を追加する。

## Requirements

1. ユーザーは配信先 URL を 1 つ登録できる。
2. 対象イベント（`order.created` など）が発生したら、その URL へ JSON ペイロードを POST する。
3. ペイロードにはイベント種別とリソース ID を含める。

## Payload (initial)

```json
{
  "event": "order.created",
  "id": "ord_123"
}
```

## Delivery

- イベント発生時に同期的に HTTP POST する。
- 2xx が返れば成功とみなす。

## Out of scope

- 複数 URL の登録
- 管理 UI
