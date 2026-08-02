---
description: 複数 PR のマージ順序を事前計画してリベースコストを最小化する
argument-hint: '[PR numbers or branch names]'
allowed-tools: Bash(gh pr list:*), Bash(gh pr view:*), Bash(gh pr diff:*), Bash(gh api:*), Bash(git log:*), Bash(git fetch:*)
---

複数の PR を作成・マージする際の順序を事前計画してください。対象: $ARGUMENTS

## 手順

### 0. Preflight 検証 (前提)

マージ順序を計算する前に、**対象 PR が本当にマージ対象かを検証**する。`/preflight $ARGUMENTS` を先に実行するか、以下を直接実行する:

```bash
git fetch origin main
git log origin/main --oneline -15                                    # main に関連コミットが既にあるか目視

# 対象 PR ごとに REST API で state を直接取得 (gh pr view の GraphQL はキャッシュ遅延あり)
for pr in <PR numbers>; do
  gh api repos/OWNER/REPO/pulls/$pr --jq '{number, state, merged, merged_at, mergeable_state}'
done

# 類似キーワードで並行 in-flight PR を検索
gh pr list --state open --search "<keyword>" --json number,title,headRefName,author

# 直近 close 済 PR も確認 (並行作業の痕跡)
gh pr list --state closed --search "<keyword>" --limit 5 --json number,title,mergedAt
```

判定基準:

- **対象 PR に merged=true が含まれる** → その PR を対象から除外してユーザーに報告
- **類似 keyword の別 open PR が存在** → 並行作業あり、続行前にユーザー確認
- **main に同内容のコミット既に存在** → タスク obsolete の可能性、続行前にユーザー確認

この Step を飛ばして依存グラフ作成に進んではならない。`gh pr list` のキャッシュ遅延で closed PR を OPEN と誤判定し、**重複作業・force-push 計画・stale commits 分析に時間を費やした事例が複数回発生している** (2026-04-11 セッションで 4 重複 PR)。

### 1. 対象 PR の収集

各 PR について以下を取得:

```bash
gh pr diff <number> --name-only
```

変更ファイルリストを記録する。

### 2. 依存グラフの作成

PR 間の関係を3種類に分類:

- **包含関係**: PR A の変更が PR B に全て含まれている → A をマージして B をクローズ
- **ファイル衝突**: 同じファイルを変更する → 先にマージした方の変更を他方がリベースで取り込む必要あり
- **独立**: 変更ファイルが重ならない → 順序に依存しない

### 3. マージ順序の決定

優先ルール:

1. **独立 PR を最初にマージ** — コンフリクトリスクなし
2. **包含される PR を先にマージ** — 上位 PR は後で rebase
3. **ファイル衝突 PR はボトムアップ** — 変更量の少ない PR を先に
4. **hot file を触る PR は特に慎重** — `src/lib/review-engine.mjs`, `src/lib/local-runner.mjs`, `src/lib/verifier.mjs` など

### 4. レポート出力

以下の形式（プレースホルダー）で結果を報告:

```markdown
<!-- 以下は出力テンプレート例。実際の PR 番号・ファイル名・行番号に置き換えて使用 -->

## マージ順序計画

### 依存グラフ

- PR #<number> → PR #<number> （ファイル衝突: <file>, <file>）
- PR #<number> （独立）

### 推奨マージ順序

1. PR #<number>（独立、ファイル衝突なし）
2. PR #<number>（ボトムアップ: 変更量少）
3. PR #<number>（リベース必要: 上流マージ後にファイル X が変更されている）

### リベース予想コスト

- PR #<number>: `<file>:<line>` 付近で約 N 行のコンフリクト見込み
```

## Hot File リスト

以下のファイルは複数 PR で同時に触られやすいため、特に警戒。最新の churn は次のコマンドで確認:

```bash
git log --format= --name-only --since=6.months | sort | uniq -c | sort -rn | head -20
```

現時点の代表例:

- `src/lib/review-engine.mjs` — レビュー生成の中心
- `src/lib/local-runner.mjs` — CLI 実行パス
- `src/cli.mjs` — CLI エントリポイント
- `src/lib/verifier.mjs` — 検証ロジック
- `runners/core/review-runner.mjs` — plan 構築
- `schemas/output.schema.json` — 出力スキーマ

## Branch Protection Strict Mode 対応

マージ先ブランチが `strict: true`（ブランチが常に最新 main と同期している必要がある）の場合、PR を順番にマージするたびに残りの PR が stale になり、更新 → CI 待ち → merge → 更新... のループに陥る。N 本の PR があると CI 待ち時間が N 倍になる。

**最初に確認する:**

```bash
gh api repos/OWNER/REPO/branches/main/protection --jq .required_status_checks.strict
# true が返ったら以下の戦略を適用
```

**推奨戦略（N 本の独立 deps PR を一括処理する場合）:**

1. **可能なら 1 つの PR に統合する** — `package.json` が重複する deps 系 PR は 1 ブランチにまとめると更新ループが発生しない
2. **統合できない場合: 同一 SHA への一括 update-branch** — マージ開始前に全ての残ブランチを現在の `origin/main` SHA へ同時に更新する。これで各 PR が並列に CI を実行する。マージするたびに次ブランチを更新する（1 回ずつで済む）
3. **lock-file-only 衝突の解消** — `gh api .../pulls/N/update-branch` が 422 を返す場合: 新 PR を作らず、ブランチをローカルで checkout して `git merge origin/main` → `npm install --package-lock-only` でロックファイルを再生成 → merge commit → 通常の `git push` で解消する。push は fast-forward になるため force は不要。update-branch 自体が base を head へ merge する API なので、ローカル merge は API が自動解決できなかった分を引き継ぐだけである。rebase は force push を要求するので使わない。新 PR 作成は CI 履歴・レビューコメントの消失を招く

**同一 SHA 一括更新の例（独立 PR のみ — ファイル共有・スタック無し）:**

```bash
# 残 PR を一度に全部 update-branch する（force push は使わない）
set -e
for pr in 101 102 103; do
  gh api --method PUT "repos/OWNER/REPO/pulls/$pr/update-branch"
done
# その後 CI が通ったものから順次 merge
```

## 禁止事項

- **Step 0 の Preflight 検証を省略して Step 1 以降に進んではならない**
- 依存関係を調べずにマージ順序を決めてはならない
- Hot file の複数 PR 同時マージを推奨してはならない
- 「順序は適当で大丈夫」と断定してはならない
- `gh pr list` / `gh pr view` の GraphQL 結果のみで state を信頼してはならない (必ず `gh api repos/.../pulls/{N}` で裏取り)
- strict mode 環境で N 本 PR を「1 本ずつ更新して CI を待つ」ことで済ませない（N 倍の CI 待ちが発生する）
- push 済みブランチを rebase して force push（`--force-with-lease` / `--force-if-includes` を含む）で上書きしてはならない（AGENTS.md Safety。取り込みは update-branch か `git merge`）
