---
id: suppress-flaky-review-comments
title: ブレる／誤検出の AI レビュー指摘を抑制する
sidebar_label: 誤検出の指摘を抑制
description: AI コードレビューのブレや誤検出を、Riverbed Memory の suppression と suppression-feedback スキルで抑制する使い方。人間承認を前提に、決定論検出器の canary と責務を分けます。
keywords:
  - false positive AI review
  - suppress AI review comments
  - AIコードレビュー 誤検出
  - River Review
---

「reduce false positives AI code review」「suppress noisy AI review comments」「stable AI review」で検索してたどり着いた方向けのレシピです。

## 課題

AI のコードレビューは、実行するたびに指摘内容が揺れたり、実装意図と食い違う誤検出を出したりします。同じ指摘が PR ごとに再燃すると、レビュー全体の信頼性を損ないます。やがて開発者は通知そのものを読み飛ばすようになります。River Review はこの揺れや誤検出を、レビュー判断の記録として抑制の対象に変えます。

## River Review はどう抑制するか

River Review は誤検出への対処を 2 つの層に分けています。決定論的な検出器は canary（誤検出パターン集）で守られ、一度直した誤検出が再発しないことを機械的に保証します。意味的なノイズや実装意図との食い違いは、midstream フェーズの `suppression-feedback` スキルが扱います。

`suppression-feedback` スキルは、検出された指摘を 4 つの区分に整理します。機械的な削除はせず、レビュアーが抑制か修正かを選べるよう補助します。判断結果は `river suppression add` を通じて Riverbed Memory に記録されます。

- `false_positive`: 実装意図に対する誤検知として記録する区分である。
- `accepted_risk`: リスクを認識したうえで残すと決めた指摘に付ける区分である。
- `duplicate`: 既存 fingerprint の指摘と重複するときに参照を張る区分である。
- major / critical の指摘は、`accepted_risk` として根拠つきで区分した場合を除き、自動抑制されない（HIGH_SEVERITY guard）。minor / info のノイズはどの区分でも自動抑制される。

この判断が Riverbed Memory に残ると、後続 PR のレビューは同じノイズの再燃を防げます。

## やってみる

専用のデモはありませんが、Riverbed Memory の suppression で同じ流れを試せます。次の手順で、誤検出と判断した指摘を記録します。

1. レビュー実行後、抑制したい指摘の fingerprint を控える。
2. その指摘が誤検知か、リスク受容かを判断する。
3. `river suppression add` で区分と根拠を記録する。

```bash
river suppression add \
  --fingerprint <fp> \
  --feedback false_positive \
  --rationale "なぜ誤検知と判断したかを 1〜2 文で残す" \
  --expires 2027-01-01
```

`--expires` は任意です。付けると、その日時を過ぎた時点で抑制が外れ、finding が再び出ます。付けない場合は無期限になります。受け付ける値と期限切れ後の挙動は、[repo-wide review の導入とチューニング](../guides/repo-wide-review.md) の「抑制に期限を付ける」節にまとめています。

登録後の挙動と保存手順は、[Riverbed Memory を使用する](../guides/use-riverbed-memory.md) にまとまっています。決定論的な検出器がどこまで誤検出を防ぐかは、[検出器の評価レポート](../reference/detector-evaluation-report.md) で確認できます。設計思想は [Riverbed Memory](../explanation/riverbed-memory.md) を参照してください。

## やらないこと

- suppression entry を自動生成しない。書き込みは人間の承認を必要とする。
- 指摘を勝手にマージ判断へ反映しない。River Review は auto-merge せず、最終判断を人間に委ねる。
- 静的解析やカスタム linter の置き換えではない。決定論的な領域は canary が守り、意味的な判断だけを `suppression-feedback` に任せる。
- major / critical の指摘を無条件には抑制しない。`accepted_risk` と根拠がそろって初めて自動抑制を許す。
