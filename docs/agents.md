# Agents—Adding Project Knowledge Packs

PocketEitan の AI エージェント資産を外部リポジトリで再利用するための手順をまとめます。`agents/spec/agent.schema.json` と `agents/examples/*.agent.yaml` を基準に、新しいプロジェクト向けのナレッジパックを作成してください。

## ディレクトリ構成

```text
agents/
├── spec/agent.schema.json      # JSON Schema（AJVで検証可能）
└── examples/
    └── pocket-eitan.agent.yaml # PocketEitanの実例
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

2. PocketEitan以外のプロジェクトでも同じスキーマに従って記述する
   - 既存の例をコピーしてフィールドを置き換える
   - 余分なフィールドは含めないでください（スキーマ `additionalProperties: false` のため）

3. チェックリストを `.github/ai-review/checklists/` 配下に追加・更新する
   - `security.md`, `language/*.md`, `quality/*.md` など必要なカテゴリを追加
   - PocketEitanの例を参考に、AIエージェントがレビューできる形式で箇条書きにする

4. ドキュメントとREADMEを更新する
   - `docs/agents.md`（本ファイル）とREADMEに手順・コマンドを追記
   - PRテンプレートに背景・変更点・テスト結果・影響範囲・チェックリストを含める

## 検証コマンド

`package.json` には AJV + js-yaml を利用した検証スクリプトを追加しています。

```bash
# 例: 全サンプルファイルがスキーマと一致するか検証
npm run agents:validate
```

CI でも `.github/workflows/validate-agents.yml` により同じ検証が実行されます。

## ベストプラクティス

- PocketEitan の YAML をベースとして追加・削除が必要なセクションを洗い出す
- `metadata.updatedAt` を ISO 8601 (UTC) で更新する
- `guidelines.security` にはプロジェクト固有のリスクと対策を明記する
- `automation.ciWorkflows` にはCI名、パス、トリガー、品質ゲートを記録する
- 変更後は `pnpm lint && pnpm test` に加え `pnpm agents:validate` を必ず実行する
