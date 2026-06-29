# クイックスタート (River Review)

River Review を最小構成で動かすための流れです。River Review は、暗黙知を versioned / repo-owned な Skill（Skill Registry）として共有資産に変え、capability pack（通常 LLM キー不要）・レビュースキル・観点別レビュアーの review team の 3 主軸で動きます。本ガイドが扱うヘッドレスな GitHub Action は、その 3 主軸を CI から呼ぶ経路の 1 つです。

1. リポジトリに `skills/{upstream,midstream,downstream}` を用意し、スキルを Markdown + YAML frontmatter で作成する。最小構成の例を以下に示す。

   ```yaml
   ---
   id: my-check
   name: My Check
   description: サンプルのコード品質チェック
   category: midstream
   applyTo:
     - 'src/**/*.ts'
   severity: minor
   inputContext:
     - diff
   outputKind:
     - findings
   ---
   ```

   ファイルは `skills/midstream/my-check.md` のように配置する。必須フィールドの詳細は `schemas/skill.schema.json` を、フェーズの意味は [上流・中流・下流フェーズ](../explanation/upstream-midstream-downstream.md) を参照すること。作成手順を順を追って確認したい場合は [はじめてのスキル作成](../tutorials/creating-your-first-skill.md) を参照すること。

2. `.github/workflows/river-review.yml` などに GitHub Actions ワークフローを追加する（詳細は [GitHub Actions ガイド](./github-actions.md) を参照）。
3. 認証情報は、GitHub Action では LLM API キー（`OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GOOGLE_API_KEY` のいずれか）をリポジトリ Secrets に設定する。追加のトークンが必要になるのは、独自の連携や拡張を行う場合のみ。なお **LLM キーが要るのはこのヘッドレス GitHub Action（や standalone CLI）だけ**で、Claude Code / Cursor 等の **AI エージェントがスキルを適用する通常利用ではキーは不要**（[River Review とは § 実行モデル](../explanation/what-is-river-review.md) を参照）。
4. PR を作成し、指定フェーズのスキルが実行されることを確認する。

最小の Actions 定義は [GitHub Actions ガイド](./github-actions.md) を参照してください。
