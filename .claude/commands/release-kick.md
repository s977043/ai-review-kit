---
description: release-please のリリース PR を BLOCKED 解除 → CI green 確認 → マージ → リリース公開検証まで一貫実行する（v1.44.0〜v1.53.0 の11リリースで実証済みの型）
argument-hint: '<release PR number>'
allowed-tools: Bash(gh api user:*), Bash(gh auth switch:*), Bash(gh pr view:*), Bash(gh pr checks:*), Bash(gh pr merge:*), Bash(gh api:*), Bash(gh run list:*), Bash(gh release view:*), Bash(git ls-remote:*), Bash(scripts/release-please-kick.sh:*), Bash(bash scripts/release-please-kick.sh:*)
---

release PR #$ARGUMENTS を、BLOCKED 解除からマージ・リリース公開の検証まで一貫して実行する。

release-please が生成するリリース PR の head は `GITHUB_TOKEN` push であるため、通常は `mergeStateStatus: BLOCKED`（"N of N required checks are expected"）になる（CLAUDE.md「`N of N required checks are expected` = bot/GITHUB_TOKEN push」ガード参照）。この BLOCKED の原因・`RELEASE_KICK_PAT` のセットアップ・`workflow_dispatch` 経由の代替手順は `docs/runbook/release-please-kick.md` が SSoT。本コマンドはそれを前提に、実際にマージして公開を確認するまでの実行手順を1コマンド化したもの。矛盾があれば runbook を正とし、本コマンドを修正する。

## 手順

### Step 1. gh アカウント確認

```bash
gh api user --jq .login | grep -q s977043 || gh auth switch -u s977043
```

PreToolUse hook (`gh-account-guard.sh`) が defense-in-depth で効くが、セッション開始時の確認は省略しない。
`s977043` は本リポジトリのメンテナアカウント（CLAUDE.md「Verify gh active account before write ops」ガードと同一の値で、そちらが SSoT）。フォーク運用時は自分のアカウントに読み替える。

### Step 2. PR 状態の確認

```bash
gh pr view $ARGUMENTS --json state,mergeStateStatus,headRefOid
```

`mergeStateStatus: BLOCKED` は release-please PR の通常挙動。`CLEAN` なら Step 3〜4 をスキップして Step 5 へ進む。

### Step 3. release-please-kick の実行

```bash
bash scripts/release-please-kick.sh
```

空コミットで新しい head を作り、`pull_request: synchronize` を実ユーザー相当のトークンで発火させる。ブランチ名を省略すると open な release PR を自動検出する。詳細・`RELEASE_KICK_PAT` 未設定時のエラー・`workflow_dispatch` 経由の代替は runbook 参照。

### Step 4. 新 head の CI 実発火確認

```bash
gh run list --limit 5 --json databaseId,status,conclusion,headBranch,workflowName
```

新 head の run が `action_required` のまま止まっていないか（＝実発火しているか）を確認する。`action_required` のままなら `RELEASE_KICK_PAT` 未設定などが疑われる。runbook のトラブルシュートへ。

### Step 5. CI green までポーリング

Monitor ツールは使わず、1つの Bash 呼び出し内で sleep しながらポーリングする。**ポーリング用の変数名に `status` を使わない**（zsh の読み取り専用変数と衝突し代入が失敗する）。

```bash
for i in $(seq 1 8); do
  pendingCount=$(gh pr checks $ARGUMENTS --json name,bucket --jq '[.[] | select(.bucket=="pending")] | length')
  echo "iteration $i: pending=$pendingCount"
  [ "$pendingCount" = "0" ] && break
  sleep 14
done
gh pr checks $ARGUMENTS --json name,bucket --jq '.[] | select(.bucket != "skipping")'
```

- 8 回（約 2 分弱）で `pending` が解消しない場合はループを打ち切り、実出力を提示したうえで待機を継続するか判断を仰ぐ
- `fail` バケットが出た場合は直ちに報告し、原因調査へ切り替える（本コマンドはマージ前提の手順であり、CI 失敗の修正は別タスク）

### Step 6. BEHIND の場合

```bash
gh api "repos/:owner/:repo/pulls/$ARGUMENTS" --jq '{mergeable_state}'
```

`behind` なら:

```bash
gh api "repos/:owner/:repo/pulls/$ARGUMENTS/update-branch" -X PUT
```

update-branch で CI が再実行されるため Step 5 のポーリングをやり直す。

### Step 7. マージ

`mergeStateStatus: CLEAN` かつ Step 5 の CI が green になったら:

```bash
gh pr merge $ARGUMENTS --squash --delete-branch
```

### Step 8. 検証

- Release Please workflow の run が success で終わっていることを `gh run list` で確認する
- tag が merge commit と一致することを確認する。`repos/:owner/:repo/git/ref/tags/<tag>` が単発 404 を返す場合は `git ls-remote --tags origin` でも照合する
- `gh release view <tag>` で release が published になっていることを確認する

## 禁止事項

- `git push --force`
- `git reset --hard`
- `gh pr merge --admin`（`enforce_admins: true` の場合はそもそも BLOCKED を回避できない）
- release PR の内容（CHANGELOG / バージョン番号等）へのファイル編集。本コマンドは release-please が生成した内容をそのままマージする手順であり、内容修正が必要な場合は release-please の設定側を直す

## 参照

- `docs/runbook/release-please-kick.md`（SSoT: BLOCKED の原因、`RELEASE_KICK_PAT` セットアップ、`workflow_dispatch` 代替手順）
- CLAUDE.md「`N of N required checks are expected` = bot/GITHUB_TOKEN push」ガード
