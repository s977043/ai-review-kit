---
description: 'Run review-team skill: parallel multi-role review with consensusLevel and Tech Lead report'
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(river-review:*), Bash(npx river-review:*)
---

スキル定義: `skills/agent-skills/review-team/SKILL.md`

## Context

- Status: `git status`
- Diff: `git diff`
- Recent commits: `git log --oneline -10`

差分がない場合は「差分がありません」と伝えて終了する。

## Task

`review-team` スキルの手順に従い、現在の差分をレビュー・チームで検査する。

### Step 1: ロールを決定する

引数でロールが指定された場合はそれを使う。なければ `auto`（差分から自動選択）。

### Step 2: river-review を実行する

```bash
# auto モード（推奨）
river-review run --reviewers auto --output json

# ロール明示指定
river-review run --reviewers <role1,role2,...> --output json
```

`river-review` がなければ `npx river-review` を使う。コスト確認が必要なら先に `--dry-run`。

### Step 3: 結果を報告する

JSON 出力（`teamLeadReport` / `issues`）をもとに以下の形式で報告する。

```markdown
## レビュー・チーム 結果

### 実行ロール

<reviewerRole の一覧>

### 優先確認の指摘（top3）

<consensusLevel → severity 順の上位3件。multi は ★★、consensus は ★★★ を付ける>

### 全指摘（severity 降順）

<critical → major → minor → info の順>

### 見落とし可能性

<blindSpots の label。空なら「なし（全ロールを実行済み）」>

### コンセンサス集計

consensus: N件 / multi: N件 / single: N件
```
