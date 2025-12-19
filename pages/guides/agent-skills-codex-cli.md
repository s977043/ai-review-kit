---
title: Agent Skills と Codex CLI 連携設計ガイド
---

OSS プロジェクトに Agent Skills を統合し、Codex CLI からシームレスに活用するための設計ガイドです。公式仕様との互換性を優先しつつ、スキル作成・配布・実行をスクリプト可能にするための実装ヒントをまとめました。

## 1. リポジトリ構成の標準化

- `skills/` 直下にスキルごとのフォルダを置き、必ず `SKILL.md` と付属スクリプト・資料を同梱する。
- 公式のサンプルに倣い、形式別サブフォルダ（`docx/`, `pdf/`, `pptx/`, `xlsx/` など）を切ると整理しやすい。
- `spec/` に公式仕様（例: `agent-skills-spec.md`）を格納し、`template/` に `SKILL.md` 雛形や共通スクリプトを置く。
- Codex CLI 連携のため、`skills/` を `~/.codex/skills/` に同期するスクリプトやシンボリックリンクを用意する。リポジトリ固有の隠しディレクトリ（例: `.codex/skills/`）を参照する運用も有効。

## 2. SKILL.md テンプレート自動生成

- 独自サブコマンド例: `codex skill create <name>` でスキルフォルダと `SKILL.md` をテンプレートから生成する。
- テンプレートには YAML フロントマターの必須項目を初期値つきで用意する。

```markdown
---
id: rr-midstream-<domain>-001
name: <Skill Name>
description: <スキルが何をチェックするか>
phase:
  - midstream # 単一でも配列でも可
applyTo:
  - 'src/**/*.ts' # できるだけ絞り込む
tags:
  - example
severity: minor # info | minor | major | critical
inputContext:
  - diff # diff / fullFile / tests / adr / commitMessage / repoConfig
outputKind:
  - findings # findings / summary / actions / tests / metrics / questions
modelHint: balanced # cheap / balanced / high-accuracy
# x-allowed-tools: 'Bash, Read, Write' # 拡張フィールドは x- プレフィックスで
---

# <Skill Name>
```

- 既存スキーマ（`schemas/skill.schema.json`）準拠の項目をデフォルトとし、拡張は `x-` 接頭辞で衝突を避ける。

- 生成後に `npm run skills:validate` などの検証コマンドを自動実行し、記法ミスを早期に検知する。
- 対話モードや AI プロンプト補助を組み合わせ、入力された概要から雛形を自動補完する実装を検討する。

## 3. スキル管理用 CLI サブコマンド

- `codex skill install <repo-or-url> [<name>]` で Git からスキルを取得し、`~/.codex/skills/<name>` へ配置する。
- `codex skill list` で有効スキルの一覧（名前・説明・パス）を表示し、`--json` オプションで機械可読出力も提供する。
- `codex skill search <keyword>` で name/description を部分一致検索する。
- `codex skill disable|enable <name>` で一時的な無効化・再有効化を行う。
- `codex skill run <name> "<ユーザ指示>"` で特定スキルを明示的に呼び出し、デバッグや検証を容易にする。

## 4. 活用シナリオの整理

- ドメイン知識のパッケージ化（例: 法務レビュー、社内データ分析手順）をスキル化し、自然言語指示だけで起動できるようにする。
- 新能力の付与（例: プレゼン資料自動生成、PDF フォーム抽出）では、スキル内のスクリプトを Bash などで実行できるようにする。
- 複数ステップのワークフロー（フォーマット統一、レビュー→修正→再検証など）をスキルに落とし込み、抜け漏れ防止と再現性を担保する。
- Codex CLI 上では `--enable skills` 付きで起動し、`skills/` が正しく読み込まれることを `codex skill list` などで確認する。

## 5. 公式仕様との互換性と拡張

- YAML フロントマターの必須フィールド（`name`, `description` など）は公式仕様に従う。記述は第三者視点で、発動条件を明確にする。
- 独自フィールドは `x-` プレフィックスなどで衝突を避け、公式エージェントが無視しても破綻しない設計にする。
- `allowed-tools` や `model` の解釈は公式動作に合わせ、セキュリティ上の制約（ツールホワイトリスト、ユーザー確認、監査ログ）を踏襲する。
- 標準仕様の更新を定期監視し、差分を `spec/` とスキル群に反映する運用フローを用意する。

## 6. README / ドキュメント改善のチェックリスト

- プロジェクト概要: Agent Skills 準拠で拡張可能なエージェントであることを冒頭に明記し、公式リソースへのリンクを置く。
- 機能ハイライト: 「SKILL.md ベースの拡張」「Codex CLI 管理コマンド」「テンプレート生成ツール」などを箇条書きで示す。
- インストール: Codex CLI の有効化フラグ（`--enable skills`）、スキルフォルダの配置先、環境変数の設定例を具体的に記載する。
- Quickstart: スキルが発火する対話例や `codex skill list` 出力例を載せ、セットアップ確認の導線にする。
- スキル一覧: カテゴリごとに name/description を簡潔に列挙し、各フォルダへのリンクを付ける。
- スキル作成方法: CLI 生成コマンドや記述時のベストプラクティス（名前付け、発動条件の書き方、ファイル分割の推奨）を短くまとめる。
- 互換性とライセンス: 独自拡張の扱い方針とスキルごとのライセンス整理を明示する。

## 7. テストと検証の運用例

- スキル追加・更新後は `npm test` と `npm run lint` を実行してフォーマットと挙動を確認する。
- スキルメタデータは `npm run skills:validate` で検証し、Codex CLI へのインポート前に破損がないか確認する。
- Codex CLI 側でも `codex skill list` や実際の対話テストを行い、SKILL.md で定義した発動条件どおり動作するか確認する。
