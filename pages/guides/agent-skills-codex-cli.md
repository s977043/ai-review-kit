---
title: Agent Skills と Codex CLI の統合ガイド
---

OSS プロジェクトへ Agent Skills を取り込み、Codex CLI から活用するための構成例と運用アイデアをまとめます。River Reviewer のスキル定義フローに加えて、CLI での自動生成や配布を視野に入れた設計です。

## リポジトリ構成の推奨

- `skills/` 直下にスキルごとのフォルダを置き、`<skill-name>/SKILL.md` と関連スクリプト・資料を同梱する。
- 目的別のサブフォルダ（例: `skills/docx/`, `skills/pdf/`, `skills/pptx/` など）を切ってモジュール化すると参照性が高まる。
- 仕様や作成手順をまとめた `spec/`（例: `spec/agent-skills-spec.md`）と、雛形を置く `template/`（例: `template/SKILL.md`）を併設し、共通指針を一箇所に集約する。
- Codex CLI との連携を考慮し、`skills/` を `~/.codex/skills/` に同期するスクリプトやシンボリックリンクを用意する。プロジェクト内に `.codex/skills/` を持ち、CLI 起動時にそこを参照させる運用も有効。

## SKILL.md 雛形の自動生成

- `codex skill create <skill-name>` のような CLI サブコマンドで、テンプレートからスキルフォルダと SKILL.md を生成する。
- テンプレートには YAML frontmatter を含め、少なくとも以下を初期値として埋める:
  - `name`: スキル名
  - `description`: 概要と利用シナリオ
  - `allowed-tools`: 例として `"Bash, Read, Write"`
  - `model`: 例として `default`
  - `version`: 例として `0.1.0`
  - `license`: 例として `Complete terms in LICENSE.txt`
- 対話型で name/description などを入力させる、または簡単なプロンプトから雛形を生成する AI 支援フローを追加すると、スキル作成の敷居が下がる。
- 生成後に `skills-ref validate <path>` で構成検証し、`skills-ref to-prompt <paths>` でエージェント用メタデータを抽出する処理を自動実行する。

## スキル管理コマンドの設計例

- `codex skill install <repo-or-url> [<skill-name>]`: リポジトリや URL からスキルを取得し、`~/.codex/skills/<skill-name>` に配置する。
- `codex skill list`: インストール済みスキルを名称・概要付きで一覧表示（表形式や JSON 出力オプションを検討）。
- `codex skill search <keyword>`: name/description を部分一致で検索し、該当スキルを絞り込む。
- `codex skill disable <skill-name>` / `enable <skill-name>`: 一時的な無効化・再有効化を行い、プロンプト肥大を抑える。
- `codex skill run <skill-name> "<user-prompt>"`: 指定スキルを強制ロードし、デバッグ用途で直接実行する。

## 公式仕様との互換性を保つポイント

- YAML frontmatter の必須フィールド（例: `name`, `description`）は公式仕様に従い、第三者視点で簡潔に記述する。
- 独自フィールドを追加する場合は、公式エージェントが無視しても問題ないように設計する（例: `x-` プレフィックス）。
- `allowed-tools` や `model` の解釈は公式準拠で実装し、スキル間の互換性を損なわないようにする。

## README / ドキュメントの強化ポイント

- プロジェクト概要に「Agent Skills 準拠」「Codex CLI で利用可能」であることを明記し、公式リポジトリへのリンクを添える。
- 機能ハイライトとして「スキル管理コマンド」「テンプレート自動生成」「Codex CLI 連携」を箇条書きで示す。
- インストール手順に `CODEX_SKILLS_PATH` の設定や `--enable skills` オプションの利用を記載する。
- Quickstart にスキル使用例、`codex skill list` などのコマンド例、標準スキル一覧と説明を入れる。
- スキル作成手順（テンプレート生成コマンドの使い方、frontmatter ベストプラクティス）と、独自拡張がある場合の互換性方針を明示する。
- スキルごとのライセンスと謝辞を整理し、外部由来のコンテンツを参照する場合は出典を明記する。

## 運用上のヒント

- 大規模モデルに大量のスキルを読み込む場合は、不要スキルを `disable` しつつ必要に応じて `run` で検証するワークフローが有効。
- スキル更新時は `skills-ref validate` や `npm run skills:validate` などの検証を CI に組み込み、文法や必須フィールド漏れを早期に検知する。
