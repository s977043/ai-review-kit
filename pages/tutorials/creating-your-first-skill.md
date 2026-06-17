# 最初のスキルを作成する

Upstream → Midstream → Downstream のフローに従うシンプルな River Review スキルを作成します。

## 前提条件

- Node.js がインストールされていること
- リポジトリをクローンし、依存関係がインストールされていること (`npm install`)

## 1. スキルメタデータの作成

`skills/` 配下にスキル ID と同名のディレクトリを作成し、その中に `SKILL.md` を置きます（例: `skills/midstream/rr-midstream-hello-skill-001/SKILL.md`）。各スキルを独立したディレクトリに格納することで、フィクスチャや eval 用の兄弟ディレクトリ（`fixtures/`、`eval/` など）を同じ場所に置けます。`/schemas/skill.schema.json` に一致するメタデータを先頭に含めます:

```yaml
---
id: rr-midstream-hello-skill-001
name: Hello World Skill
description: Markdown 内の TODO コメントを検出する
category: midstream
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

スキルをコミットし、PR を開き、River Review の PR テンプレートを使用して関連する Issue をリンクし、検証が通過したことを証明してください。
