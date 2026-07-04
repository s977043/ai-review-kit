---
id: enforce-plan-conformance
title: 計画（plan）に反した実装を検出する
sidebar_label: 計画からの逸脱を検出
description: 承認済みの計画（plan）から実装が逸脱するドリフトを、River Review の upstream ゲートと midstream 照合で検出する使い方を、runnable なデモ付きで解説します。
keywords:
  - plan conformance
  - implementation drift
  - AIコードレビュー
  - River Review
---

AI エージェントへ実装を任せる場面が増えています。すると承認済みの計画（plan）から成果物が静かに逸脱し、ドリフトを生みます。こうしたズレは diff を追うだけで気づくのが難しく、レビューの盲点になりがちです。

## River Review はどう対処するか

River Review は、レビュー基準をリポジトリ所有の SKILL.md として保有します。判断は計画・差分・テストを横断して行われ、diff 単体だと見えないズレも捉えます。plan conformance に効くスキルは次のとおりです。

- `plangate-exec-conformance`（upstream）— 実装差分が plan / todo / test-cases に沿うか検査し、計画外の変更・未実装項目・テスト欠落などのドリフトを検出する中核スキルである。
- `plangate-plan-integrity`（upstream）— plan / pbi-input / todo / test-cases といった計画アーティファクト間で整合性が保たれているか検査し、実装前に仕様の抜けをあぶり出すスキルである。
- `plan-review-gate`（upstream）— AI 自律実行の前段でゲートとして働き、plan / pbi-input が抱える危険操作・スコープ外・過実装・人間承認の必要な条件を早期に検出するスキルである。
- `design-source-conformance`（midstream）— `DESIGN.md` やデザイントークンといった定義を持つリポジトリで、新規 UI の色・余白・フォントサイズが定義スケールに準拠しているか照合するスキルである。
- `existing-pattern-conformance`（midstream）— grep で同種の先行実装を洗い出し、その防御・バリデーション・エラー処理・規約が新実装に正しく継承されているか確認するスキルである。

diff だけだと見えない計画とのズレを、upstream ゲートと midstream 照合の二層で捉えます。

## やってみる

まずはランナブルなデモで挙動を確認しましょう。API キーや `npm install` は要らず、5 分あれば読み切れます。

- デモ一式（`plan.md` / `diff.patch` / `test-cases.md` / `expected-findings.json`）は [`examples/plan-conformance-demo`](https://github.com/s977043/river-review/tree/main/examples/plan-conformance-demo) にある。
- `plan.md` が約束する 3 点（バリデーション追加・レスポンス互換維持・エラー時 400）と、`diff.patch` の実装を読み比べる。
- 機械可読な期待出力 `expected-findings.json` には critical / major の指摘 3 件が並び、`plan` と突き合わせて初めて分かる内容である。

自分のリポジトリで動かす際は、フェーズを絞って実行できます。詳しい手順は [フェーズ固有のレビューを実行する](../guides/run-phase-specific-review.md) にまとまっています。

## できないこと

River Review が提示するのは、あくまで判断材料です。以下のことは担いません。

- River Review はレビューの判断材料を提示するにとどまり、合否や auto-merge の最終決定まで代行しない。
- 静的解析やカスタム linter が担う構文・パターンの決定論的検査を、River Review は置き換えない。
- 計画そのものの事業価値や優先順位の妥当性は人間が決める領域であり、スキルの守備範囲外にある。

## 関連

- [フェーズ固有のレビューを実行する](../guides/run-phase-specific-review.md)
- [上流・中流・下流フェーズ](../explanation/upstream-midstream-downstream.md)
- [plan-conformance デモ](https://github.com/s977043/river-review/tree/main/examples/plan-conformance-demo)
