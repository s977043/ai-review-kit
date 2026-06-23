---
title: 代表スキルのショーケース
---

River Review のスキルが「なぜ重要か」「どう機能するか」「どんな出力を返すか」を、実在する代表スキルを通して紹介します。新しいスキルを設計するとき、または既存スキルの書き方を参照するときの出発点として活用してください。

スキルの概念そのものは [スキル—River Review の心臓部](../explanation/skills.md) を、全スキルの索引は [スキルカタログ](../reference/skills-catalog.md) を参照してください。

各スキルについて、次の観点で順番に解説します。

1. スキルの目的と選定理由
2. `SKILL.md` frontmatter の抜粋
3. レビュー指示の核心
4. fixture（検出対象コード）の例
5. 期待出力サンプル
6. false-positive 回避ルール

## スキル 1: Logging and Observability Guard

ID は `rr-midstream-logging-observability-001` です。midstream フェーズで動作します。

### 目的と選定理由

このスキルは、握りつぶされた例外やログのない `catch` を検出して、障害時に原因を追跡できる状態を守ります。例外の握りつぶしは静かに障害を埋もれさせるため、可観測性を支える代表的なレビュー観点として選びました。

### frontmatter の抜粋

```yaml
id: rr-midstream-logging-observability-001
name: Logging and Observability Guard
description: Ensure code changes keep logs/metrics/traces useful for debugging failures and regressions.
category: midstream
applyTo:
  - 'src/**/*.{ts,tsx,js,jsx,mjs,cjs}'
tags: [observability, logging, reliability, midstream]
severity: minor
inputContext: [diff]
dependencies: [tracing, code_search]
```

`severity` は `minor` です。可観測性の欠落は直接の不具合ではないものの、運用時のデバッグ性を下げるため指摘対象になります。

### レビュー指示の核心

`prompt/system.md` は次の 3 点を検出します。

- 障害原因を追跡できるログ・メトリクス・トレースが過不足なく残っているか
- 例外を握りつぶさず、requestId や入力要約などの文脈を付けて処理しているか
- retry・fallback・cache の分岐に hit/miss/attempt のシグナルがあるか

ログ基盤の選定や詳細設計には踏み込みません。指摘は差分と結びつく範囲にとどめます。

### fixture の例

`fixtures/01-silent-catch.diff` は、ログや再送出をともなわない空の `catch` を検出対象とします。

```diff
+  } catch (error) {
+    // ignore
+  }
+}
```

### 期待出力サンプル

`golden/01-silent-catch-happy.md` は、上記の fixture に対する finding を固定しています。

```text
src/services/user.ts:16: 例外が握りつぶされています。障害時に原因追跡が困難になります。
Fix: logger.error でエラーをログし、throw error で再送出するか、適切にハンドルしてください。
```

finding は `ファイル:行: 説明。Fix: 改善案` の形式です。`severity` は `minor` または `major`、`confidence` は high / medium / low から選ばれます。

### false-positive 回避ルール

次のケースでは指摘を抑制します。

- `catch` 内にログがある、または `throw` や `return Promise.reject(...)` で上位へ伝播している
- 理由コメント付きで明確に意図された無視である
- テストコード内の意図的な無視である

`golden/02-proper-error-handling.md` は、文脈付きログと再送出をそなえたコードに対して `NO_ISSUES` を返す挙動を固定しています。さらに実行前ゲートにより、可観測性に無関係な差分では `NO_REVIEW` を返します。

## スキル 2: Coverage and Failure Path Gaps

ID は `rr-downstream-coverage-gap-001` です。downstream フェーズで動作します。

### 目的と選定理由

このスキルは、変更されたコードのうちクリティカルパスや失敗フローに対するテストの欠落を検出します。テストなしの変更は回帰を見逃す原因になるため、downstream の品質ゲートとして選びました。

### frontmatter の抜粋

```yaml
id: rr-downstream-coverage-gap-001
name: Coverage and Failure Path Gaps
description: Find missing tests for critical paths, edge cases, and failure handling in changed code.
category: downstream
applyTo:
  - 'src/**/*'
  - 'lib/**/*'
  - '**/*.test.*'
  - '**/*.spec.*'
tags: [tests, coverage, reliability, downstream]
severity: major
inputContext: [diff, tests]
dependencies: [test_runner, coverage_report]
```

`severity` は `major` です。失敗フローのテスト欠落は回帰へ直結するため、ログ欠落より高い重大度を設定しています。

### レビュー指示の核心

`SKILL.md` の Rule は次の 3 点を確認します。

- 主要フローと失敗フローの両方にテストがあるか
- 例外系・タイムアウト・リトライなどのエラーハンドリングをテストしているか
- 変更で追加された分岐・境界値・フォールバックをカバーしているか

既存テストの全面的な書き換えや、カオス試験の設計には踏み込みません。

### fixture の例

このスキルは fixture ファイルではなく判定の手がかり（Heuristics）で検出します。代表的な手がかりは次のとおりです。

- 新しい条件分岐やガードが追加されたのに、対応するテストがない
- 例外処理やエラーリターンに対するアサーションが見当たらない
- 認証・課金・データ保存などのクリティカルパスにテストが不足している

### 期待出力サンプル

finding は差分に紐づけて、根拠と次のアクションをそえて返します。改善案は次のように提示します。

```text
新規/変更された分岐ごとに正常系・異常系のテストを追加してください（例外メッセージも検証）。
タイムアウト/リトライ/フォールバックをモックし、意図した失敗動作を確認してください。
```

### false-positive 回避ルール

次のケースでは指摘を抑制します。

- 既存テストが同等の失敗経路を十分にカバーしている
- テスト対象が外部 API の仕様変更のみで、社内コードに実行分岐が増えていない

実行前ゲートにより、コメントやドキュメントのみの変更など実行パスへ影響しない差分では `NO_REVIEW` を返します。

## 次のステップ

- 新しいスキルを書くときは [スキル作成ガイド](./write-a-skill.md) を参照してください。
- スキルの選択と組み合わせは [スキルの選択と組み合わせ](./choose-skills.md) を参照してください。
- スキーマの詳細は [スキルスキーマリファレンス](../reference/skill-schema.md) を参照してください。
