# Agents—Adding Project Knowledge Packs

River Review の AI エージェント資産を外部リポジトリで再利用するための手順をまとめます。ここで作るナレッジパックは、暗黙知を versioned / repo-owned な Skill（Skill Registry）として共有資産に変える 3 主軸のうち、観点別レビュアーで構成される review team の定義をプロジェクトへ持ち込む部分にあたります。`agents/spec/agent.schema.json` と `agents/examples/*.agent.yaml` を基準に、新しいプロジェクト向けのナレッジパックを作成してください。

## ディレクトリ構成

```text
agents/
├── spec/agent.schema.json      # JSON Schema（AJVで検証可能）
└── examples/
    └── river-review.agent.yaml # River Reviewの実例
```

## 追加手順

1. `agents/examples/` に `<project>.agent.yaml` を作成する
   - `version`: スキーマに準拠したバージョン（例: `v1.0.0`）
   - `metadata`: リポジトリ情報（owner/repository, license, tags, updatedAtなど）
   - `guidelines`: プロジェクト固有の原則・プロセス・禁止事項
   - `tooling`: パッケージ管理、利用言語、品質ゲート、DoD
   - `agents`: Codex/Gemini/Copilotなど役割別のプロンプト・レビュー指示
   - `resources`: 参照ドキュメント・チェックリスト・ナレッジ
   - `automation`: GitHub Actionsなどの自動化資産

2. 他のプロジェクトでも同じスキーマに従って記述する
   - 既存の例をコピーしてフィールドを置き換える
   - 余分なフィールドは含めないでください（スキーマ `additionalProperties: false` のため）

3. チェックリストを `.github/river-review/checklists/` 配下に追加・更新する
   - `security.md`, `language/*.md`, `quality/*.md` など必要なカテゴリを追加
   - River Reviewの例を参考に、AIエージェントがレビューできる形式で箇条書きにする

4. ドキュメントとREADMEを更新する
   - `pages/guides/agents.md`（本ファイル）とREADMEに手順・コマンドを追記
   - PRテンプレートに背景・変更点・テスト結果・影響範囲・チェックリストを含める

## 検証コマンド

`package.json` には AJV + js-yaml を利用した検証スクリプトを追加しています。

```bash
# 例: 全サンプルファイルがスキーマと一致するか検証
npm run agents:validate
```

CI でも `.github/workflows/validate-agents.yml` により同じ検証が実行されます。

## ベストプラクティス

- River Review の YAML をベースとして追加・削除が必要なセクションを洗い出す
- `metadata.updatedAt` を ISO 8601 (UTC) で更新する
- `guidelines.security` にはプロジェクト固有のリスクと対策を明記する
- `automation.ciWorkflows` にはCI名、パス、トリガー、品質ゲートを記録する
- 変更後は `npm run lint && npm test` に加え `npm run agents:validate` を必ず実行する

## プログラマティック利用

YAML ナレッジパックではなく、スクリプトや自動化パイプラインから River Review を呼び出す場合は以下を参照してください。

- **Node.js API** — `runners/node-api/README.md`: JavaScript/TypeScript から River Review を直接呼び出す方法
- **CLI** — `runners/cli/README.md`: シェルスクリプトや CI ステップから実行する方法
