---
description: 'Run review-team skill: parallel multi-role review with consensusLevel and Tech Lead report'
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(npm run river:*)
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

### Step 2: レビューを実行する

River Review は npm 未公開のため `npx river-review` は使えない。**エージェントがこのスキルの手順を直接実行する**（CLI 不要）。上記 Step 1 で決めたロールを並列に走らせ、Union-Find で finding を統合し、consensusLevel と teamLeadReport を生成する。

リポジトリ内で作業していて `river` CLI をアクセラレータとして使える場合のみ、次を利用してよい（任意）。コスト確認が必要なら先に `--dry-run`。

```bash
# auto モード（推奨）
npm run river -- run . --reviewers auto --output json

# ロール明示指定
npm run river -- run . --reviewers <role1,role2,...> --output json
```

CLI が存在しない、または失敗した場合は、スキル駆動のレビューで継続する。

### Step 3: 結果を報告する

JSON 出力（`teamLeadReport` / `issues`）をもとに以下の形式で報告する。

```markdown
## レビュー・チーム 結果

### 実行ロール

<reviewerRole の一覧>

### 優先確認の指摘（top3）

<consensusLevel → severity → scope 順の上位3件。multi は ★★、consensus は ★★★ を付ける。scope は上位2キーが同値のときだけ in-diff を先に置く。pre-existing の finding には file:line の直後に `_(pre-existing)_` を付ける>

### 全指摘（severity 降順）

<critical → major → minor → info の順。scope が pre-existing の finding には file:line の直後に `_(pre-existing)_` を付ける。in-diff（本 PR の追加行由来）は既定値なので印を付けず、pre-existing（変更ファイル内だが追加行の外）だけを示す>

### 見落とし可能性

<blindSpots の label。空なら「なし（全ロールを実行済み）」>

### コンセンサス集計

consensus: N件 / multi: N件 / single: N件
```
