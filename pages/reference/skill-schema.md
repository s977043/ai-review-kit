# スキルスキーマ概要

River Reviewer のスキルは、メタデータに YAML frontmatter を使用し、ガイダンスに Markdown を使用します。メタデータフィールドは `schemas/skill.schema.json` によって検証されます。

## フィールド

- `id` (string, required): 一意の識別子（例: `rr-upstream-design-architecture-001`）。移動やリネームを行っても安定している。
- `name` (string, required): 人間が読めるスキル名。
- `phase` (string, required): `upstream`、`midstream`、または `downstream` のいずれか。
- `applyTo` (string[], required): スキルが評価すべきファイルのグロブパターン。
- `trigger` (object, optional): `phase` と `applyTo` のオプションのラッパー（`trigger.files` は別名）。トップレベルと `trigger` の値の両方が存在する場合、トップレベルが優先される。
- `description` (string, required): スキルが何をチェックするかの簡潔な説明。
- `tags` (string[], optional): 関連するスキルをグループ化するキーワード。
- `severity` (string, optional): 影響レベル。`info`/`minor`/`major`/`critical` のいずれか。
- `inputContext` (string[], optional): スキルが期待する必須入力。許可される値には `diff` | `fullFile` | `tests` | `adr` | `commitMessage` | `repoConfig` がある。
- `outputKind` (string[], optional, default `['findings']`): スキルによって生成される出力カテゴリ。典型的な値: `findings` | `summary` | `actions` | `tests` | `metrics` | `questions`。省略時は `findings` がデフォルトになる。
- `modelHint` (string, optional): モデル選択のヒント。`cheap`/`balanced`/`high-accuracy` のいずれか。
- `dependencies` (string[], optional): 必要なダウンストリームツール/リソース。例: `code_search` | `test_runner` | `adr_lookup` | `repo_metadata` | `coverage_report` | `tracing` | `custom:*`（拡張機能用）。

## YAML 例 (midstream performance)

```yaml
---
id: rr-midstream-performance-002
name: Midstream Performance Budget Check
phase: midstream
tags:
  - performance
  - latency
severity: major
applyTo:
  - 'src/**/*.ts'
  - 'packages/**/src/**/*.{ts,js}'
description: Flag midstream changes that risk latency regressions or heavy resource use.
---
Ensure changed code paths avoid unnecessary synchronous I/O and unbounded concurrency. Avoid repeated heavy computations. Recommend benchmarks when touching hot paths.
```

## trigger を使用した YAML 例

```yaml
---
id: rr-midstream-performance-003
name: Midstream Performance Budget Check
trigger:
  phase: midstream
  files:
    - 'src/**/*.ts'
description: Flag midstream changes that risk latency regressions or heavy resource use.
---
Ensure changed code paths avoid unnecessary synchronous I/O and unbounded concurrency. Avoid repeated heavy computations. Recommend benchmarks when touching hot paths.
```
