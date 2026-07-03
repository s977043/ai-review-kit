---
description: docs/governance.md の「マージ前チェックリスト」を PR 番号 1 つに対して実行し、MERGE_OK / BLOCKED を判定する
argument-hint: '<PR number>'
allowed-tools: Bash(gh pr checks:*), Bash(gh pr view:*), Bash(gh pr diff:*), Bash(gh api:*), Bash(git fetch:*), Bash(git log:*)
---

マージ前チェック: PR #$ARGUMENTS が `gh pr merge` 可能な状態か、`docs/governance.md` § 「PR レビューとマージ」>「マージ前チェックリスト」(SSoT) の全項目を実コマンドで検証して判定する。

このスキルは `gh pr merge` を実行する **直前** に呼び出すことを想定している。抽象的な確認でなく、以下の検証コマンドを実際に実行して MERGE_OK / BLOCKED の判定まで行う。詳細な背景・pagination の落とし穴・disposition ルールの正は `docs/governance.md` にあり、本コマンドは実行手順の具体化のみを担う。

## 検証手順

### Step 1. CI green の確認

```bash
gh pr checks $ARGUMENTS --json name,bucket --jq '.[] | select(.bucket != "skipping")'
```

- 全チェックが `pass` バケットであることを確認する（`skipping` は除外可）
- `pending` が残る場合はマージせず、完了まで待ってから再実行する
- `fail` がある場合はマージ不可。pre-existing の main 失敗でも本 PR を直接マージせず、先に main を green に戻す（governance.md § 1 参照）

### Step 2. レビュアー line comments の全件列挙と disposition 確認

```bash
gh api --paginate "repos/:owner/:repo/pulls/$ARGUMENTS/comments?per_page=100" \
  --jq '.[] | {id, in_reply_to_id, user: .user.login, path, line, commit: .commit_id, body}'
```

- `--paginate` は必須である（デフォルトは 1 ページ 30 件で打ち切られ、多コメント PR で見落としが発生する）
- `per_page=100` は URL クエリに直接埋め込む（`-F per_page=100` は verb が POST になり HTTP 422 が返る）
- 列挙した各コメントについて disposition を 1 つずつ確定する:
  1. 追従コミットで適用済み
  2. 不適用（同スレッドに reply で理由を明記済み、または bot 自身が resolved 宣言済み）
  3. follow-up Issue で追跡（Issue 番号を reply に明記）
- disposition 未確定のコメントが 1 件でも残る場合はマージ中止。詳細は governance.md § 「レビュアーコメントの扱い」を参照

### Step 3. review state の確認

```bash
gh pr view $ARGUMENTS --json reviews,reviewDecision --jq '{reviewDecision, reviews: [.reviews[] | {author: .author.login, state}]}'
```

- `gemini-code-assist[bot]` / `Copilot` は非同期で review を投稿するため、PR 作成直後は review 未着の可能性がある。着弾を待ってから Step 2 を再実行する
- review state はレビュー単位のサマリであり、これ単体でマージ可否を判断してはならない（`reviewDecision` が空でも line comments が存在し得る）

### Step 4. dist freshness の確認（該当 PR のみ）

```bash
gh pr diff $ARGUMENTS --name-only | grep '^runners/github-action/src/' || echo "not applicable"
```

- `runners/github-action/src/**` を触らない PR はこの Step をスキップする
- 該当する場合、`.nvmrc` の Node バージョンで `npm run build:action` 済みであることを確認する。Step 1 で `Action dist freshness` チェックが green ならビルド済みとみなしてスキップ可
- 失敗時のトラブルシュートは `docs/development/dist-check-rebuild-guide.md` を参照

### Step 5. 複数 PR 並行時の追加確認

複数 PR を連続マージする作業の一部としてこのコマンドを実行している場合:

- `/preflight <PR numbers>` で対象 PR が obsolete / 並行作業中でないことを先に検証する
- `/plan-merge-order <PR numbers>` でマージ順序を事前計画する（本 PR がその順序の先頭であることを確認する）

### Step 6. strict mode の注意

branch protection が `strict: true` の場合（このリポジトリの main は該当）、PR が最新 main よりも遅れているとマージできない。

```bash
gh api "repos/:owner/:repo/pulls/$ARGUMENTS" --jq '{mergeable_state}'
```

- `behind` なら `gh api "repos/:owner/:repo/pulls/$ARGUMENTS/update-branch" -X PUT` で更新する。**CI が再実行されるため Step 1 からやり直す**
- update-branch の 422 (lock-file conflict) は新 PR を作らず、`npm install --package-lock-only` → force-push で解消する（`/plan-merge-order` の strict mode 節を参照）

## 判定

### A. MERGE_OK

条件: Step 1〜4 が全て pass（Step 4 は該当時のみ）、Step 5〜6 の該当事項なし。

対応: 各 Step の確認結果（CI チェック数 / コメント件数と disposition / review state）を添えて報告し、`gh pr merge` に進んでよい。

### B. BLOCKED

条件: いずれかの Step で未達がある。

対応: BLOCKED の理由を Step 番号付きで**全件列挙**し（最初の 1 件で打ち切らない）、それぞれの解消アクション（fix commit / reply / follow-up Issue / update-branch / CI 待ち）を提示する。解消後に本コマンドを再実行する。

## 禁止事項

- Step を省略したまま MERGE_OK と判定してはならない
- `--paginate` なしの列挙結果で「コメントなし」と判定してはならない
- review state（`reviewDecision`）のみで line comments の確認を省略してはならない
- disposition 未確定のコメントを残したまま `gh pr merge` に進んではならない
- 本コマンドの手順と governance.md が食い違う場合、governance.md を正としてこちらを修正する

## なぜこのスキルが必要か

マージ前チェックリスト（CI green / line comments の全件 disposition / preflight / dist Node 整合）は `docs/governance.md` に SSoT として整備されたが、完全手動運用のため実行漏れが起きやすい。特に line comments は CI を失敗させないため見落とされ、`--paginate` 忘れによる部分列挙も観測されている。`/preflight` / `/verify-agent-report` と同様に、**実行可能な決定論チェックリストとして 1 コマンド化**することで、マージのたびに確実に全項目を通す。
