# ワーカー規律テンプレート

委託ワーカー（`Agent` ツールで起動する background 実装エージェント）のプロンプトに毎回複製している規律定型の SSoT。オーガナイザーはワーカーを起動する際、下記「コピペ用テンプレート」をプロンプトへ含める。

## 背景

複数 PR を並行委託する運用では、同じ規律（gh アカウント guard、Node バージョン、`--no-verify` 禁止など）を毎回プロンプトに手で書き起こしており、書き漏れが個別インシデントの原因になってきた。CLAUDE.md の AI Misoperation Guards はオーガナイザー自身のセッションには自動適用される。しかし `Agent` ツールで起動したワーカーは新規セッションであり、CLAUDE.md を読まない場合がある（サブエージェント定義次第）ため、規律をプロンプト本文に明示的に含める必要がある。

## コピペ用テンプレート

以下をワーカー委託プロンプトの末尾にそのまま含める。

```text
## 作業規律（厳守）

- gh の書き込み系操作（pr create/merge/edit, issue create, api の POST/PATCH/PUT/DELETE 等）の前に毎回:
  `gh api user --jq .login | grep -q s977043 || gh auth switch -u s977043`
  404 や permission エラーが出たら、まずこのアカウント切り替わりを疑うこと。
- シェルの PATH 先頭に `/opt/homebrew/opt/node@22/bin` を通してから作業すること。既定の `node`（v26 系）を使わない。
  worktree で作業する場合は最初に `npm ci` を実行すること（lockfile 由来の依存不整合を防ぐ）。
- `git commit` / `git push` で `--no-verify` を使わないこと。lint-staged が manifest 再生成・textlint を担っており、
  スキップすると CI で初めて失敗が露見する。
- 履歴を書き換える・破棄する操作は行わないこと。禁止対象は `git push --force`（`-f` も同じ）、
  `git push --force-with-lease`、`git reset --hard`、`git stash drop` のすべて。
  `--force-with-lease` は「安全な force」ではなく、ここでは force 禁止の例外にならない。
  push が reject される等で rebase や force push が必要に見えた場合は、自分で判断せず作業を止めて
  オーガナイザーに報告すること（リモートに追随するだけなら `git pull --rebase` で解消してよい）。
- commit subject は小文字または日本語で始めること（commitlint の subject-case ルールに抵触するため大文字始まりは reject される）。
  例: `fix: ...` / `feat: ...` / `docs: ...`（日本語 subject も可）。
- Monitor ツールは使用しないこと。CI やポーリング待ちが必要な場合は、1つの Bash 呼び出し内で
  `for i in $(seq 1 N); do ...; sleep <秒>; done` の形で自力ポーリングすること。
  ポーリング用の変数名に `status` を使わないこと（zsh の読み取り専用変数と衝突し代入が失敗する）。
- 検証は実際のコマンド出力と exit code で判定すること。テスト件数・lint 結果などの報告数値は、
  自分の記憶や推測ではなく実行したツール出力から転記すること。
- 作業は PR 作成 → CI green の確認までとし、マージは行わないこと（マージはオーガナイザー側が実施する）。
- 完了報告には以下を必須項目として含めること: PR 番号、head の commit SHA、CI 結果（実出力を添える）、
  変更したファイル一覧。
- セッション上限（時間・ターン数）に達しそうな場合は、未完了のまま放置せず、その時点の成果を
  commit + push してから状態を報告すること。
- 日本語ドキュメントを編集した場合は `npx textlint --no-cache <files>` が pass することを確認し、
  同じパスで `npm run fix:dashes` も実行すること。
```

## 各項目の詳細・根拠

### gh アカウント guard

`gh` の keyring には `s977043`（本リポジトリ用）と `kominem-unilabo`（別業務用）の2アカウントを登録している。アクティブアカウントはセッション中に無言で切り替わることがある（複数回観測済み）。PreToolUse hook（`.claude/hooks/gh-account-guard.sh`）は defense-in-depth として効く。ただし hook が効かない環境（ワーカーの worktree で `.claude/settings.json` の hook 設定が引き継がれない場合等）もあり得るため、プロンプト側にも明示する。詳細: CLAUDE.md「Verify gh active account before write ops」。

### Node バージョン / worktree の `npm ci`

既定シェルの `node` は v26 系だが、本リポジトリは `.nvmrc` で Node 22（`22.22.2`）に固定されている。lockfile 操作は Node 22 で行うことが安全側。worktree は独立した `node_modules` を持たないため、作業開始時に `npm ci` を実行しないと依存解決が壊れた状態で作業することになる。詳細: `docs/runbook/dev.md`、memory `local-node-version-mismatch`。
なお `/opt/homebrew/opt/node@22/bin` というパスは、本リポジトリのメンテナ開発機（Apple Silicon + Homebrew）を前提とした値。他環境の場合、各自の Node 22 系の入手先に読み替える（バージョン要件の SSoT は `.nvmrc` / `engines.node`）。

### `--no-verify` 禁止

lint-staged が pre-commit で manifest 再生成・`textlint --no-cache` を担っており、`--no-verify` でスキップすると CI の Lint job で初めて失敗が露見し、修正コストがワーカー委託後まで持ち越される。CLAUDE.md の repo rules 全般でも `--no-verify` は明示的な合意なしに使わない方針。

### force 系操作の禁止

`--force-with-lease` は名前から「安全な force」と解釈されやすい。しかし lease が保証するのは「リモートの ref が自分の知る値から動いていないこと」だけであり、自分自身が壊した履歴をそのまま上書きする事故は防げない。AGENTS.md Safety の destructive commands 禁止（`git reset --hard` / `git push --force` 等）はワーカーにも適用される。ただし `--force-with-lease` が含まれるかは字面から読み取れないため、テンプレート側で明示的に列挙し、例外解釈の余地を消す。ワーカーは並行 PR やマージ順序の全体像を持たないため、force が必要に見える状況はエスカレーション対象とし、判断はオーガナイザーへ寄せる。

### commit subject の大小文字

commitlint の subject-case ルールにより、大文字始まりの subject（例: `Fix AGENTS.md typo`）は commit-msg フックで reject される。小文字始まり（`fix: ...`）または日本語始まりの subject を使う。詳細: memory `commitlint-subject-case`。

### Monitor 禁止・sleep 自力ポーリング

ワーカーセッションでの Monitor ツール利用は停止・ハングの原因になることが観測されている。CI やマージ待ちなど時間のかかる確認は、1つの Bash 呼び出し内で `sleep` を挟んだ for ループとして自力ポーリングする。ポーリング変数名に `status` を使うと zsh の読み取り専用変数と衝突し代入が失敗するため、別名（例: `pendingCount` / `ciState`）を使う。詳細: `.claude/commands/release-kick.md` の Step 6 に実装例がある。

### 検証は実出力 + exit code

報告の具体性（もっともらしい PR 番号・テスト件数・コマンド出力ブロック）は実行の証拠にならない。ワーカー自身も、検証結果を記憶や推測ではなく実行したコマンドの実出力・exit code から転記すること。オーガナイザー側の裏取り手順は `/verify-agent-report` を参照。

### PR 作成までで停止・マージ禁止

複数ワーカーが並行してマージまで行うと、マージ順序やコンフリクトの管理が破綻する。マージ判断（`/merge-check` の実行含む）はオーガナイザー側に一元化する。

### 完了報告の必須項目

PR 番号 / head SHA / CI 結果（実出力）/ 変更ファイル一覧が揃っていないと、オーガナイザー側の `/verify-agent-report` による裏取りができない。

### セッション上限時の扱い

作業途中でセッション上限に達した場合、未commitの成果を残したまま終了すると引き継ぎ時に失われるリスクがある。成果を commit + push し、状態（完了した Step / 残タスク）を報告する。

### 日本語 docs の textlint

`npm run lint:text` はキャッシュを再利用するため、新規追加した違反を見逃すことがある。`npx textlint --no-cache <files>` で直接検証し、`npm run fix:dashes` も同じパスで実行する。詳細: CLAUDE.md「Doc-edit textlint」ガード。

## 関連

- CLAUDE.md—AI Misoperation Guards（本テンプレートの各項目の一次情報）
- `.claude/hooks/gh-account-guard.sh`—gh アカウント guard の実装
- `.claude/commands/verify-agent-report.md`—オーガナイザー側の完了報告裏取り手順
- `.claude/commands/release-kick.md`—sleep ポーリングの実装例
- `docs/runbook/dev.md`—Node バージョン / worktree セットアップ
