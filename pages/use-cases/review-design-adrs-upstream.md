---
id: review-design-adrs-upstream
title: 設計・ADR を上流でレビューする
sidebar_label: 設計・ADR を上流でレビュー
description: River Review の上流（upstream）スキルで、設計ドキュメントや ADR をコード実装前にレビューし、失敗設計・互換・可観測性・プライバシーの抜けを見つける方法。
keywords:
  - ADR review
  - design review
  - upstream review
  - River Review
---

設計ドキュメントを AI でレビューするためのレシピです。River Review は、コード実装より前の上流（upstream）フェーズで、設計や ADR をレビューします。設計の抜けをコード実装より前に見つけられるため、手戻りコストが下がります。

## 問題

設計ドキュメントや ADR の欠陥は、コードを書き始めてから気づくと修正コストが跳ね上がります。失敗時の挙動、互換方針、可観測性といった観点は、実装差分に現れず、設計レビューでのみ捕まえられます。midstream の diff レビューが動くころには、設計判断はすでにコードへ焼き込まれています。

## River Review はどう解決するか

River Review は、コードより前段にある設計ドキュメントそのものを、上流（upstream）スキルでレビューします。設計プランや ADR が差分に含まれると、次の 3 つの上流スキルへ自動でルーティングされます。各スキルは設計基準に照らして判断し、指摘（findings）と修正アクションを返します。

- `architecture-validation-plan` — 設計に検証計画（SLO/SLI・テスト・ロールバック/カナリア・可観測性）が欠けていないかを検出する上流スキルである。
- `agent-architecture-review` — 全体設計・責務分離・依存方向・境界破綻の検知に加え、根拠（ADR）なき決定を問う上流スキルである。
- `security-privacy-design` — データ保持・削除・バックアップ所在・越境移転・暗号化など、プライバシー設計の抜けをレビューする上流スキルである。

いずれも `phase: upstream` として動き、実装差分ではなく設計ドキュメントを読んで初めて分かる指摘を返します。

## やってみる

まずは API キー不要の最小デモで、上流レビューが出す判断を読んでみましょう。対象は Webhook 配信機能の設計プランです。実装差分に現れない 3 件の指摘（failure-mode/リトライ、ペイロード互換、可観測性）を、デモで確認できます。

手順:

- `examples/upstream-design-review-demo/` を開く（[GitHub で読む](https://github.com/s977043/river-review/tree/main/examples/upstream-design-review-demo)）。
- `design-plan.md`（レビュー対象）と `expected-findings.json`（期待される指摘）を突き合わせる。
- 自分の設計プランや ADR が入った差分で、上流レビューを走らせる。

## やらないこと（限界）

River Review が自動化するのは、あくまで設計に対する判断です。マージや承認は自動化せず、最終判断を必ず人間が担います。また、上流スキルは静的解析（linter や型チェック）を置き換えません。構文やパターンで決まる指摘は、静的解析に任せます。上流スキルは、設計・スコープ・受入基準といった意味的な妥当性に集中します。

- 自動マージや自動承認はしない。人間の最終判断（human-in-the-loop）を前提とする。
- 静的解析（linter・型チェック・SAST）の置き換えではない。意味的な設計レビューに特化する。
- 差分に無いコードを推測した指摘や、根拠のない一般論は返さない。

## 関連

- [Upstream / Midstream / Downstream の考え方](../explanation/upstream-midstream-downstream.md)
- [River Review とは](../explanation/what-is-river-review.md)
- デモ: [upstream-design-review-demo](https://github.com/s977043/river-review/tree/main/examples/upstream-design-review-demo)
