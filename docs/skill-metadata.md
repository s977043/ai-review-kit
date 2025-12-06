# River Reviewer Skill Metadata Specification

この文書では、River Reviewer の各スキルの frontmatter で使われるメタデータの項目を定義します。これらの項目は、エージェントにスキルの特性を伝え、スキルローダーやランナーが適切に処理できるようにします。

## 基本項目（既存）

| フィールド | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| id | string | ✔ | スキルのユニークな識別子 |
| name | string | ✔ | スキルの名前 |
| description | string | ✔ | スキルの概要説明 |
| phase | string | ✔ | このスキルが適用される SDLC フェーズ |
| applyTo | string[] | ✔ | スキルが適用されるファイルパターン |
| tags | string[] | ✘ | スキルに付かるタグ |
| severity | string | ✘ | 問題の重大度 |

## 拡張項目（新規）

| フィールド | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| inputContext | string[] | ✔ | スキルが前提とする入力コンテキスト |
| outputKind | string | ✔ | スキルの出力がどのセクションに対当するか |
| modelHint | string | ✘ | 推奨モデルレベルや実行コストのヒント |
| dependencies | string[] | ✘ | サブツールや外部依存 |

## frontmatter のサンプル

```yaml
---
id: rr-midstream-code-quality-sample-001
name: Sample Code Quality Pass
description: Checks common code quality and maintainability risks.
phase: midstream
applyTo:
  - "src/**/*.ts"
tags: [style, maintainability, midstream]
severity: minor
inputContext:
  - diff
  - fullFile
outputKind: findings
modelHint: balanced
dependencies:
  - code_search
  - test_runner
---
```

## 本仕素の運用

- `schemas/skill.schema.json` を本仕素に合わせて更新し、定義された全フィールドを検証できるようにする。
- スキル追加・更新の際は、本ファイルで定義された項目に従うこと。未知のフィールドを追加する場合は別途提案し、仕素をアップデートする。
