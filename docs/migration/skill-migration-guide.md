# Skill Migration Guide: Legacy → Registry Format

このガイドは、既存の YAML frontmatter 形式のスキルを新しい Registry 形式に移植する手順を説明します。

## 概要

River Review v0.1.2 から、スキルは「Skills as First-Class Assets」アーキテクチャに移行しています：

- **Legacy 形式**: 単一の Markdown ファイル（YAML frontmatter + 本文）
- **Registry 形式**: ディレクトリベース（skill.yaml + prompt files + fixtures + golden + eval）

## なぜ移行するのか？

1. **評価の標準化**: promptfoo 統合により、スキルの品質を自動評価
2. **テスト駆動**: fixtures と golden により、回帰テストが容易
3. **プロンプトの分離**: system と user プロンプトの明確な分離
4. **スケーラビリティ**: スキルが増えても管理しやすい構造

## 移植手順

### 1. 対象スキルの選定

移植するスキルを選びます。推奨基準：

- ✅ 代表的でよく使われるスキル
- ✅ 評価しやすい（入力/出力が明確）
- ✅ ある程度の複雑さがある（小さすぎない）

### 2. ディレクトリ構造の作成

```bash
mkdir -p skills/{skill-id}/{prompt,fixtures,golden,eval}
```

例：

```bash
mkdir -p skills/security-basic/{prompt,fixtures,golden,eval}
```

### 3. skill.yaml の作成

YAML frontmatter のメタデータを `skill.yaml` に移植します。

**Legacy 形式 (スキル.md の先頭)**:

```yaml
---
id: security-basic
name: Baseline Security Checks
description: Check common security risks...
phase: midstream
applyTo: ['**/*.{ts,tsx,js,jsx}']
tags: [security, midstream, web]
severity: major
inputContext: [diff]
outputKind: [findings, actions]
dependencies: [code_search]
---
```

**Registry 形式 (skill.yaml)**:

```yaml
id: security-basic
version: 0.1.0 # 新規フィールド
name: Baseline Security Checks
description: Check common security risks...

phase: midstream
applyTo:
  - '**/*.{ts,tsx,js,jsx}'

tags:
  - security
  - midstream
  - web

severity: major

inputContext:
  - diff

outputKind:
  - findings
  - actions

modelHint: balanced # オプション

dependencies:
  - code_search

# 新規フィールド: プロンプトと評価の参照
prompt:
  system: prompt/system.md
  user: prompt/user.md

eval:
  promptfoo: eval/promptfoo.yaml

fixturesDir: fixtures
goldenDir: golden
```

### 4. プロンプトファイルの作成

Markdown 本文を `prompt/system.md` と `prompt/user.md` に分割します。

#### prompt/system.md

システムレベルの指示（スキルの目的、ルール、ヒューリスティクスなど）：

```markdown
# {Skill Name} - System Prompt

You are a {role} specializing in {domain}.

## Goal / 目的

{目的の説明}

## Non-goals / 扱わないこと

{スコープ外の項目}

## Rule / ルール

{ルールのリスト}

## Heuristics / 判定の手がかり

{判定基準}

## False-positive guards / 抑制条件

{偽陽性を避ける条件}

## Good / Bad Examples

{良い例・悪い例}
```

#### prompt/user.md

実行時の具体的な指示（タスク、入力、出力形式など）：

```markdown
# {Skill Name} - User Prompt

Review the provided code diff...

## Input

{入力の説明}

## Task

{タスクの手順}

## Output Format

{出力形式のテンプレート}

## Important Notes

{重要な注意事項}
```

### 5. Fixtures の作成

テストケースを `fixtures/` に作成します。最低2ケース：

- **Happy path**: 典型的な使用例
- **Edge case**: 境界条件や偽陽性回避

```markdown
# fixtures/01-{test-name}.md

## Description

{テストケースの説明}

## Input Diff

\`\`\`diff
{差分コード}
\`\`\`

## Expected Behavior

{期待される振る舞い}
```

### 6. Golden の作成

期待される出力を `golden/` に作成します。fixtures と1対1で対応：

```markdown
# golden/01-{test-name}.md

**Finding:** {発見事項}
**Evidence:** {証拠}
**Impact:** {影響}
**Fix:** {修正方法}
**Severity:** {重大度}
**Confidence:** {確信度}
```

### 7. Evaluation の設定

`eval/promptfoo.yaml` を作成します：

```yaml
prompts:
  - file://prompt/system.md
  - file://prompt/user.md

providers:
  - id: openai:gpt-4o
    config:
      temperature: 0.1
      max_tokens: 2000

tests:
  - description: { Test case description }
    vars:
      diff: file://fixtures/01-test.md
    assert:
      - type: llm-rubric
        value: |
          {Evaluation criteria}

      - type: contains
        value: '{Expected keyword}'

      - type: similar
        value: file://golden/01-test.md
        threshold: 0.7

outputPath: eval/results.json
```

### 8. README.md の作成

スキルのドキュメントを作成します：

```markdown
# {Skill Name}

{概要}

## 概要

{詳細な説明}

## 使用方法

{使い方}

## 出力例

{サンプル出力}

## テストケース

{テストケースの説明}

## 設計判断

{なぜこの設計にしたか}

## 改善履歴

{バージョン履歴}

## 関連スキル

{関連するスキル}

## 参考資料

{参考リンク}
```

### 9. Validation

移植したスキルを検証します：

```bash
# skill.yaml の検証
npm run validate:skill-yaml

# promptfoo での評価（promptfoo インストール後）
cd skills/{skill-id}
npx promptfoo eval
```

### 10. コミット＆PR

```bash
git add skills/{skill-id}/
git commit -m "feat: migrate {skill-name} to registry format"
git push
gh pr create --title "feat: migrate {skill-name} to registry format" --body "...詳細..."
```

## チェックリスト

移植完了前に確認：

- [ ] skill.yaml が Zod スキーマに準拠している
- [ ] prompt/system.md と prompt/user.md が作成されている
- [ ] 最低2つの fixtures/golden ペアがある
- [ ] eval/promptfoo.yaml が設定されている
- [ ] README.md が作成されている
- [ ] `npm run validate:skill-yaml` がパスする
- [ ] promptfoo eval が実行できる（評価結果は後で確認可）

## トラブルシューティング

### skill.yaml バリデーションエラー

```bash
npm run validate:skill-yaml
```

エラーメッセージを確認し、Zod スキーマ（`src/lib/skillYamlSchema.mjs`）と照合します。

### promptfoo が動かない

1. promptfoo がインストールされているか確認：

   ```bash
   npm install -g promptfoo
   ```

2. API キーが設定されているか確認：

   ```bash
   export OPENAI_API_KEY=your-key
   ```

3. 設定ファイルのパスが正しいか確認（`file://` プレフィックス）

## 参考スキル

初めて移植する場合は、以下を参考にしてください：

- `skills/security-basic/`: 最初の完全な移植例

## 関連ドキュメント

- [docs/specs/skill-yaml-spec.md](../specs/skill-yaml-spec.md): skill.yaml 仕様
- [skills/README.md](../../skills/README.md): スキル全体の説明

## 移行ロードマップ

### Phase 1: 基盤整備（v0.1.2）

- [x] skill.yaml 仕様の確定
- [x] Zod スキーマと検証スクリプト
- [x] create-skill スキャフォールディング
- [x] skills/ README と registry.yaml
- [x] 最初の1スキルの移植（security-basic）

### Phase 2: 評価基盤（v0.2.0）

- [ ] promptfoo 統合と回帰テスト基盤
- [ ] CI での skill 検証
- [ ] ドキュメント更新

### Phase 3: 大規模移行（v1.0.0）

- [ ] 全スキルの移行完了
- [ ] Legacy 形式のサポート終了

## よくある質問

### Q: Legacy 形式のスキルはいつまで使える？

A: v0.1.2〜v0.2.0 では両形式をサポート。v1.0.0 で Legacy 形式を廃止予定。

### Q: promptfoo 評価は必須？

A: 推奨ですが必須ではありません。ただし、品質保証のために強く推奨します。

### Q: 移植にどれくらい時間がかかる？

A: 初回は2〜3時間、慣れれば30分程度です。

## まとめ

スキルの移植により：

- ✅ テスト駆動でスキルの品質を保証
- ✅ promptfoo による自動評価
- ✅ スキルの再利用性と保守性の向上

不明点があれば、Issue で質問してください！
