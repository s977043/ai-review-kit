# 最初のスキルを作成する

Upstream → Midstream → Downstream のフローに従うシンプルな River Reviewer スキルを作成します。

## 前提条件

- Node.js がインストールされていること
- リポジトリをクローンし、依存関係がインストールされていること (`npm install`)

## 1. スキルメタデータの作成

`skills/` 配下に新しいファイルを作成し（例: `skills/rr-hello.yml`）、`/schemas/skill.schema.json` に一致するメタデータを含めます:

```yaml
---
id: rr-hello
name: Hello World Skill
description: Markdown 内の TODO コメントを検出する
phase: upstream
applyTo:
  - '**/*.md'
tags:
  - content
  - hygiene
severity: minor
---
# ここから指示を書きます...
```

## 2. フローを明確にする

- **Upstream:** チェックの意図を説明し、設計資料へのリンクを含める。
- **Midstream:** 指示本文で検出ロジックを定義する。
- **Downstream:** 発見事項の検証方法や自動修正方法を記載する。

## 3. スキルの検証

バリデータを実行して、スキーマと構造が正しいことを確認します:

```bash
npm run skills:validate
```

スキルが特定のフェーズ向けである場合、対象ファイルに対してのみレビューアが読み込むことを確認するために、簡単なテスト PR を追加してください。

## 4. レビューによる改善

スキルをコミットし、PR を開き、River Reviewer の PR テンプレートを使用して関連する Issue をリンクし、検証が通過したことを証明してください。
