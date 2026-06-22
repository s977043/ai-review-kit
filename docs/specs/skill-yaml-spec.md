# skill.yaml 仕様書

> **公開リファレンス:** スキルスキーマの公開版は [`pages/reference/skill-schema-reference.md`](../pages/reference/skill-schema-reference.md) を参照してください。本ファイルは内部仕様の詳細版です。

このドキュメントは、River ReviewのSkill定義ファイル`skill.yaml`の仕様を定義します。

## 概要

- **目的**: スキルのメタデータ、入出力仕様、評価設定を機械可読な形式で定義
- **フォーマット**: YAML
- **バージョン**: 1.0（初版）

## 基本構造

```yaml
# 必須フィールド
id: string # スキルの一意識別子
version: string # セマンティックバージョニング（例: "0.1.0"）
name: string # 人間可読な名前
description: string # スキルの目的と役割

# トリガー条件（phase/applyTo または trigger）
phase: string | string[] # SDLC フェーズ: "upstream" | "midstream" | "downstream"
applyTo: string[] # ファイルパターン（glob）

# オプションフィールド
tags: string[] # 分類タグ
severity: string # "info" | "minor" | "major" | "critical"
inputContext: string[] # 入力コンテキスト
outputKind: string[] # 出力種別
modelHint: string # モデル推奨: "cheap" | "balanced" | "high-accuracy"
dependencies: string[] # 依存する機能

# 実装参照
prompt:
  system: string # システムプロンプトのパス
  user: string # ユーザープロンプトのパス

# 評価設定（オプション）
eval:
  promptfoo: string # promptfoo 設定ファイルのパス

# テストデータ（オプション）
fixturesDir: string # fixtures ディレクトリ（デフォルト: "fixtures"）
goldenDir: string # golden ディレクトリ（デフォルト: "golden"）
```

## 必須フィールド

### id

- **型**: `string`
- **説明**: スキルの一意識別子
- **制約**:
  - 1文字以上
  - 推奨形式: `rr-{phase}-{category}-{number}`（例: `rr-midstream-code-quality-001`）
- **例**: `"design-review"`, `"rr-upstream-adr-quality-001"`

### version

- **型**: `string`
- **説明**: スキルのバージョン
- **制約**: セマンティックバージョニング形式（`x.y.z`）
- **例**: `"0.1.0"`, `"1.2.3"`

### name

- **型**: `string`
- **説明**: 人間が読みやすいスキル名
- **制約**: 1文字以上
- **例**: `"Design Review"`, `"ADR Decision Quality"`

### description

- **型**: `string`
- **説明**: スキルの目的と役割の簡潔な説明
- **制約**: 1文字以上
- **例**: `"レビュー観点に沿って設計を指摘・改善提案する"`

## トリガー条件（必須：いずれかの組み合わせ）

### phase

- **型**: `string | string[]`
- **説明**: このスキルが適用される SDLC フェーズ
- **許可値**: `"upstream"`, `"midstream"`, `"downstream"`
- **例**:

  ```yaml
  phase: midstream
  ```

  ```yaml
  phase: [midstream, downstream]
  ```

### applyTo

- **型**: `string[]`
- **説明**: このスキルが適用されるファイルパターン（glob）
- **制約**: 最低1つ以上
- **例**:

  ```yaml
  applyTo:
    - 'src/**/*.ts'
    - 'tests/**/*.test.ts'
  ```

### trigger（代替形式）

- **型**: `object`
- **説明**: トリガー条件をまとめたオブジェクト
- **プロパティ**:
  - `phase`: string | string[]
  - `applyTo`: string[]
- **例**:

  ```yaml
  trigger:
    phase: [upstream, midstream]
    applyTo: ['docs/adr/**/*']
  ```

## オプションフィールド

### tags

- **型**: `string[]`
- **説明**: スキルの分類タグ
- **デフォルト**: `[]`
- **例**: `["design", "review", "upstream"]`

### severity

- **型**: `string`
- **説明**: スキルの指摘の重要度
- **許可値**: `"info"`, `"minor"`, `"major"`, `"critical"`
- **デフォルト**: `"minor"`
- **例**: `"major"`

### inputContext

- **型**: `string[]`
- **説明**: スキルが参照する入力コンテキスト
- **許可値**: `"diff"`, `"fullFile"`, `"tests"`, `"adr"`, `"commitMessage"`, `"repoConfig"`
- **デフォルト**: `["diff"]`
- **例**: `["diff", "fullFile"]`

### outputKind

- **型**: `string[]`
- **説明**: スキルが生成する出力の種類
- **許可値**: `"findings"`, `"summary"`, `"actions"`, `"tests"`, `"metrics"`, `"questions"`
- **デフォルト**: `["findings", "summary"]`
- **例**: `["summary", "findings", "actions"]`

### modelHint

- **型**: `string`
- **説明**: 推奨されるモデルの種類
- **許可値**: `"cheap"`, `"balanced"`, `"high-accuracy"`
- **デフォルト**: `"balanced"`
- **例**: `"cheap"`

### dependencies

- **型**: `string[]`
- **説明**: スキルが依存する機能
- **許可値**:
  - `"code_search"`, `"test_runner"`, `"adr_lookup"`, `"repo_metadata"`, `"coverage_report"`, `"tracing"`
  - カスタム依存: `"custom:{name}"`
- **デフォルト**: `[]`
- **例**: `["adr_lookup", "repo_metadata"]`

### prompt

- **型**: `object`
- **説明**: プロンプトファイルへの参照
- **プロパティ**:
  - `system`: string - システムプロンプトのパス
  - `user`: string - ユーザープロンプトのパス
- **例**:

  ```yaml
  prompt:
    system: 'prompt/system.md'
    user: 'prompt/user.md'
  ```

### eval

- **型**: `object`
- **説明**: 評価設定への参照
- **プロパティ**:
  - `promptfoo`: string - promptfoo 設定ファイルのパス（オプション）
- **例**:

  ```yaml
  eval:
    promptfoo: 'eval/promptfoo.yaml'
  ```

### fixturesDir

- **型**: `string`
- **説明**: fixtures ディレクトリのパス
- **デフォルト**: `"fixtures"`
- **例**: `"fixtures"`

### goldenDir

- **型**: `string`
- **説明**: golden（期待出力）ディレクトリのパス
- **デフォルト**: `"golden"`
- **例**: `"golden"`

## 完全な例

### 最小構成

```yaml
id: 'hello-skill'
version: '0.1.0'
name: 'Hello Skill'
description: 'Minimal sample skill'
phase: midstream
applyTo:
  - '**/*'
```

### フル機能

```yaml
id: 'rr-upstream-adr-quality-001'
version: '0.1.0'
name: 'ADR Decision Quality'
description: 'Ensure ADRs capture context, decision, alternatives, and tradeoffs'

phase: upstream
applyTo:
  - 'docs/adr/**/*'
  - 'adr/**/*'
  - '**/*.adr'
  - '**/*adr*.md'

tags: [architecture, adr, decision, upstream]
severity: major

inputContext: [diff, adr]
outputKind: [summary, findings, actions, questions]
modelHint: balanced
dependencies: [adr_lookup, repo_metadata]

prompt:
  system: 'prompt/system.md'
  user: 'prompt/user.md'

eval:
  promptfoo: 'eval/promptfoo.yaml'

fixturesDir: 'fixtures'
goldenDir: 'golden'
```

## 移行戦略

### 既存形式（YAML frontmatter + Markdown）からの移行

現在の形式:

```markdown
---
id: rr-midstream-hello-001
name: Hello Skill
description: ...
phase: midstream
---

[Markdown content]
```

新形式への変換:

1. frontmatter を `skill.yaml` に移動
2. `version` フィールドを追加（初期値: `"0.1.0"`）
3. Markdown 本文を `prompt/` ディレクトリに移動（必要に応じて分割）
4. fixtures/golden/eval ディレクトリを追加

### 後方互換性

- 既存の frontmatter 形式も引き続きサポート
- `skill.yaml` が存在する場合はそちらを優先
- 移行ツール（`tools/migrate-skill.ts`）を提供予定

## バージョン履歴

- **1.0** (2025-12-29): 初版リリース
  - 基本フィールドの定義
  - prompt/eval/fixtures/golden サポート
  - 既存形式との互換性を考慮
