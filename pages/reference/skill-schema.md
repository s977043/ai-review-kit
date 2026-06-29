# スキルスキーマ概要

River Review のスキルは、メタデータに YAML frontmatter を使用し、ガイダンスに Markdown を使用します。メタデータフィールドは `schemas/skill.schema.json` によって検証されます。

## フィールド

必須フィールドは `id` / `name` / `description` / `category` の 4 つ。さらに `phase` / `category` / `trigger` のいずれか、`applyTo` / `files` / `path_patterns` / `trigger` のいずれかの組合せが必要になる (`schemas/skill.schema.json` の `anyOf` 制約)。

- `id` (string, required): 一意の識別子（例: `design-architecture`）。移動やリネームを行っても安定している。
- `name` (string, required): 人間が読めるスキル名。
- `description` (string, required): スキルが何をチェックするかの簡潔な説明。
- `category` (string, required): スキルのストリーム分類。`core` / `upstream` / `midstream` / `downstream` のいずれか。ルーティングの第一キー。
- `phase` (string | string[], optional): `upstream` / `midstream` / `downstream`。後方互換のために残されており、新規スキルでは `category` のみで十分。複数指定時は配列。
- `applyTo` (string[], required\*): スキルが評価すべきファイルのグロブパターン。`files` / `path_patterns` も別名として利用できる。
- `trigger` (object, optional): `phase` と `applyTo` (または `files`) のラッパー。トップレベルと `trigger` の値の両方が存在する場合、トップレベルが優先される。
- `tags` (string[], optional): 関連するスキルをグループ化するキーワード。
- `severity` (string, optional): 影響レベル。`info`/`minor`/`major`/`critical` のいずれか。
- `inputContext` (string[], optional): スキルが期待する必須入力。許可される値は `diff` | `fullFile` | `tests` | `adr` | `commitMessage` | `repoConfig` | `reviewSelf` | `reviewExternal` | `findingsPool` | `prDescription`。
- `outputKind` (string[], optional, default `['findings']`): スキルによって生成される出力カテゴリ。許可される値は `findings` | `summary` | `actions` | `tests` | `metrics` | `questions` | `review-audit`。省略時は `findings` がデフォルトになる。
- `modelHint` (string, optional): モデル選択のヒント。`cheap`/`balanced`/`high-accuracy` のいずれか。
- `dependencies` (string[], optional): 必要なダウンストリームツール/リソース。例: `code_search` | `test_runner` | `adr_lookup` | `repo_metadata` | `coverage_report` | `tracing` | `custom:*`（拡張機能用）。

\* `applyTo` は別名 `files` / `path_patterns` か、`trigger.files` で代替可能。

## YAML 例 (midstream performance)

```yaml
---
id: performance
name: Midstream Performance Budget Check
description: Flag midstream changes that risk latency regressions or heavy resource use.
category: midstream
phase: midstream # 後方互換のため併記可
tags:
  - performance
  - latency
severity: major
applyTo:
  - 'src/**/*.ts'
  - 'packages/**/src/**/*.{ts,js}'
---
Ensure changed code paths avoid unnecessary synchronous I/O and unbounded concurrency. Avoid repeated heavy computations. Recommend benchmarks when touching hot paths.
```

## trigger を使用した YAML 例

```yaml
---
id: performance
name: Midstream Performance Budget Check
description: Flag midstream changes that risk latency regressions or heavy resource use.
category: midstream
trigger:
  phase: midstream
  files:
    - 'src/**/*.ts'
---
Ensure changed code paths avoid unnecessary synchronous I/O and unbounded concurrency. Avoid repeated heavy computations. Recommend benchmarks when touching hot paths.
```
