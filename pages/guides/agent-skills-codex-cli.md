---
title: Manifest-driven Skills ガイド
---

River Reviewer のスキルを「マニフェスト（YAML/Markdown）」で柔軟に記述し、複数フェーズやファイルグロブにまたがって適用するための実装ガイドです。`schemas/skill.schema.json` に沿ったサンプルと、検証・運用手順をまとめています。

## 1. スキル定義フォーマット（Markdown / YAML）

### Markdown（フロントマター）

```markdown
---
id: rr-midstream-observability-001
name: Logging and Observability Guard
description: 例外を握り潰さず、適切にロギングすることを促す
phase:
  - midstream
applyTo:
  - 'src/**/*.ts'
tags:
  - observability
severity: major
inputContext:
  - diff
outputKind:
  - findings
modelHint: balanced
---

## Goal

- 例外の握り潰しやロギング漏れを減らす。
```

### YAML（ネスト構造）

```yaml
metadata:
  id: rr-downstream-test-coverage-001
  name: Test Coverage Guard
  description: 追加機能に対するテスト不足を検知する
  phase: [downstream]
  files: ['src/**/*.ts', 'tests/**/*.ts'] # files は metadata.applyTo のエイリアス（フロントマターの applyTo と同等）
  severity: major
  inputContext: [tests]
  outputKind: [findings]
instruction: |
  変更箇所に対応するテストが存在するか確認し、不足していれば具体的な提案を行う。
```

### YAML（フラット構造）

```yaml
id: rr-midstream-security-001
name: Basic Security Review
description: セキュリティ上の初歩的な落とし穴を検知する
phase: [midstream, downstream]
applyTo: ['**/*.js']
tags: [security]
inputContext: [fullFile]
outputKind: [findings]
instruction: |
  ハードコードされた秘密情報や危険な関数呼び出しを確認し、必要に応じて修正案を提示する。
```

ポイント:

- `phase` は単一/配列のいずれも許可される。
- `files` は `applyTo` のエイリアスとして利用できる。
- 本文（Markdown の場合は本文、YAML の場合は `instruction`）がスキルの指示本文となる。

## 2. ディレクトリ構成の推奨

- `skills/core/` 既定で読み込むスキル群
- `skills/community/` 外部/ライブラリ特化のスキル
- `skills/private/` プロジェクト固有のスキル
- テスト用フィクスチャは `tests/fixtures/skills/` などに分離して管理

## 3. 検証フロー

- スキーマ検証: `npm run skills:validate`
- Lint/フォーマット: `npm run lint`（markdownlint/textlint/Prettierを含む）
- ユニットテスト: `npm test`（skill-loader 含む）

CI でも同コマンドを実行し、破損したマニフェストを弾く。

## 4. 運用のヒント

- フェーズごとの適用可否を `phase` で厳密に指定し、不要なスキルの呼び出しを避ける。
- グロブ（`applyTo`/`files`）はできるだけ絞り、誤検知を減らす。
- 拡張フィールドを追加する場合は `x-` プレフィックスを付け、将来のスキーマ更新と衝突しないようにする。
- リポジトリルート以外のスキルを読み込む場合は Runner 設定（`skillsDir`）や環境変数で明示的に指定する。

## 5. 既存スキルとの互換性チェックリスト

- 必須フィールド（`id` `name` `description` `phase` `applyTo/files`）を満たす。
- `phase` の複数指定に合わせ、Runner 側でフェーズ判定が行われる（`matchesPhase`）。
- Markdown/YAML いずれの形式でも `instruction`（本文）が正しく取り出せる。
- 新しいエイリアス・拡張フィールドは既存のツールが無視しても破綻しない。
