# River Reviewer – Issue / Project 運用ルール

## 🌟 目的

River Reviewer プロジェクトでは、機能開発・スキル設計・エージェント基盤拡張を持続的に進めるため、**Issue と GitHub Projects を一調したフォーマット・フローで運用する**ことを定めています。

この文書は、Issue 作成者・レビュアー・メンテナーが同じ前提で進められるようにするための運用ルールをまとめたものです。

## 📍 1. Issue 作成ルール（Mandatory）

### 1-1. Issue テンプレートを必ず利用する

新規 Issue は `.github/ISSUE_TEMPLATE/task.md` を使用します。テンプレートには以下の項目が含まれます：

- **概要** — このタスクが何をするものなのか（必須）
- **前タスク** — 直前の Issue 番号（任意）
- **次タスク** — 次に着手する Issue 番号（任意）
- **受け入れ条件** — 完了条件を明記する（必須）

### 1-2. 必ず「フェーズラベル」を付与する

エージェント化ロードマップに正则って、Issue 作成時に下記のいずれかを付けます。フェーズなし Issue は原則受け付けません。

| ラベル | 説明 |
|---------------------|----------------------------------------|
| `phase:0-planning`  | 設計・要件整理フェーズ |
| `phase:1-schema`    | schema・型・ローダ周りの実装フェーズ |
| `phase:2-runtime`   | ランナーや選択ロジックなど実行系フェーズ |
| `phase:3-skills`    | 個別スキルの実装フェーズ |
| `phase:4-integration` | GitHub Actions 等への統合フェーズ |

### 1-3. 作業分類ラベル（kind）を付ける

Issue には必ず下記のような **kind ラベル** を付け、作業の種類を明示します。

| ラベル              | 説明 |
|---------------------|----------------------|
| `kind:design`       | 設計タスク |
| `kind:implementation` | 実装タスク |
| `kind:documentation` | ドキュメント作成 |
| `kind:test`         | テスト追加 |
| `kind:refactor`     | 改善・リファクタ |

## 📍 2. 依存関係ルール（連続性の可視化）

### 2-1. 「前タスク/次タスク」を記述

テンプレートの**前タスク**と**次タスク**欄は可能な限り記入します。

- `前タスク`: この Issue の前に完了すべき Issue 番号。
- `次タスク`: この Issue 完了後に着手すべき次の Issue 番号。

### 2-2. 依存ラベルを付ける

Issue 間の依存関係を明示するため、以下のラベルを利用します。

- `depends-on:#<番号>` — この Issue が依存している Issue。
- `blocks:#<番号>` — この Issue が完了しないと進めない Issue。

## 📍 3. GitHub Projects への自動追加と同期ルール

### 3-1. Issue は自動的に Roadmap Project に登録

Automation rules により、`phase:` ラベルの付いた Issue は Roadmap Project の `Idea` 列に自動で追加されます。

### 3-2. Project 上のカスタムフィールド

Roadmap Project には下記のカスタムフィールドを追加し、Issue ラベルや依存関係と同期します。

| フィールド名   | 種類         | 説明                   |
|----------------|--------------|------------------------|
| Phase          | Single select | `phase:` ラベルに対当 |
| Kind           | Single select | `kind:` ラベルに対当 |
| Prev Task      | Text         | 前タスク番号           |
| Next Task      | Text         | 次タスク番号           |
| Depends On     | Text         | 依存 Issue 番号        |
| Blocks         | Text         | ブロックしている Issue 番号 |

### 3-3. Project 内での並び順

以下のソート順を推奨します。

1. Phase (昇順)
2. Depends On が解決済みかどうか
3. Issue タイトル (昇順)

## 📍 4. Issue のライフサイクル

Roadmap Project 上での進行ステータスを定義します。

| カラム   | 説明                               |
|--------|------------------------------------|
| Idea   | 作成直後。フェーズと概要が記述されている状態。 |
| Build  | 担当者が作業を開始した状態。        |
| Review | プルリクエストが作成された状態。      |
| Done   | Issue がクローズされた状態。        |

## 📍 5. Epic（親Issue）運用ルール

大規模な取り組みやフェーズ全体をまとめる Issue には `epic` ラベルを付けます。例えば、`River Reviewer – Agent Roadmap` が Epic となります。

Epic Issue には関連タスク Issue をチェックリストとして列挙し、全体の進捗を把握できるようにします。

## 📍 6. 例: 正しい Issue のサンプル

```
タイトル: メタデータ仕様ドラフトの作成

概要:
スキルメタデータの拡張（inputContext, outputKind, modelHint, tools など）を定義する。

前タスク: なし  
次タスク: #12【skill.schema.json 更新】

受け入れ条件:
- docs/skill-metadata.md に項目が一覧化されている
- 既存スキル1つを例として記述
- スキーマ化しやすい形式になっている

ラベル:
- phase:0-planning
- kind:design
```

## 📍 7. ドキュメントの改証ルール

このドキュメントを変更する場合、必ず Pull Request を作成し、メンテナーの承認を得てください。プロジェクト運用に影響する変更は Epic Issue にリンクしておくこと。
