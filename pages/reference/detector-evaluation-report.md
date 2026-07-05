---
id: detector-evaluation-report
title: 決定論的検出器の評価レポート（再現可能）
sidebar_label: 検出器の評価レポート
description: River Review の決定論的（LLM 非依存）検出器が何を検出し、何を誤検出しないかを、誰でも同じコマンドで再現できる fixture 回帰で示す評価レポートです。
keywords:
  - AIコードレビュー 評価
  - deterministic code review
  - AI code review benchmark
  - false positive
  - River Review
---

River Review の決定論的（LLM 非依存）なヒューリスティック検出器が「何を検出するか」「何を誤検出しないか」を、再現可能な fixture 回帰で示すレポートです。掲載する結果は、誰でも同じコマンドで再現できます。

LLM 駆動のレビューは実行ごとに結果がぶれます。一方、決定論的な検出器は同じ入力に対して同じ結果を返すため、fixture の回帰テストで品質を機械的に担保できます。River Review はこの層を canary（誤検出パターン集）で守り、修正した誤検出が再発しないようにしています。

## 対象と方法

- **検出器**: `security-basic` / `logging-observability` / `test-existence` / `coverage-gap` である。いずれもオフライン（`--offline` / rules-only）で動き、API キーを必要としない。
- **fixture**: 検出できるべきケース（true positive）と、誤検出してはならない guard ケース（false-positive 防止）の両方を含む。
- **判定**: 各 fixture の期待値（`mustInclude` と `maxFindings`）を満たすかを機械的に検証する。
- **出典**: ケース定義は [`tests/fixtures/review-eval/cases.json`](https://github.com/s977043/river-review/blob/main/tests/fixtures/review-eval/cases.json) にある。

## 結果（2026-07-05 時点）

**13 件中 13 件が PASS** しました。内訳は次のとおりです。

| カテゴリ      | 検出器                          | 検出ケース | guard（誤検出防止） | 計  |
| ------------- | ------------------------------- | ---------- | ------------------- | --- |
| secrets       | `security-basic`                | 3          | 1                   | 4   |
| observability | `logging-observability`         | 2          | 1                   | 3   |
| tests         | `test-existence` `coverage-gap` | 5          | 1                   | 6   |
| **合計**      |                                 | **10**     | **3**               | 13  |

guard ケースは、安全なパターン（例: 秘密情報ではなく `process.env` 参照、ログ付きの `catch`、テストファイルも変更済み）を誤って指摘しないことを確認します。これらは既知の誤検出の再発を防ぐ canary として機能します（[#1070](https://github.com/s977043/river-review/issues/1070)）。

## 再現方法

次のコマンドで、上記の結果をそのまま再現できます。決定論的なので何度実行しても同じ結果となり、API キーも不要です。

```bash
npm run eval:fixtures
```

各ケースは `[PASS]` または `[FAIL]` として出力されます。ケースを追加・変更したい場合は `tests/fixtures/review-eval/cases.json` を編集してください。

## このレポートの範囲（正直な限定）

- 対象は**決定論的な検出器のみ**である。LLM 駆動スキルの精度（precision / recall）はここでは測定していない。
- 掲載値は品質の一部に過ぎず、実運用では自分のリポジトリの実際の PR で試して確かめることを推奨する。
- ベンダーが自己申告するベンチマークとは異なり、第三者が同じコマンドで検証できる点を重視している。

## 関連ドキュメント

- [評価ルーブリック](./evaluation-rubric.md)
- [評価フィクスチャの形式](./evaluation-fixture-format.md)
- [評価の keep / discard ポリシー](./eval-keep-discard-policy.md)
- [既知の制限](./known-limitations.md)
