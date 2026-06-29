# ガバナンス (Governance)

本ドキュメントは River Review の運用・意思決定の方針をまとめたものです。

## メンテナ

現時点のメンテナ（最終意思決定者）は以下です。

- @s977043

## 意思決定

- 小さな変更は PR ベースで進め、レビューで合意します
- 影響が大きい変更（破壊的変更、大規模リファクタ、方針変更）は Issue で事前に合意してから着手します
- 現時点ではメンテナが 1 名のため、メンテナの判断をもって合意とします（将来メンテナが増えた場合は本方針を更新します）

## メンテナの追加・交代

- 新しいメンテナは、継続的な貢献（複数回の PR、Issue トリアージ支援など）と、運用方針への理解を前提に検討します
- メンテナの追加・交代は Issue で提案し、理由とスコープを明記してください
- 長期間（目安: 数か月）メンテナ活動がない場合の扱いは、状況に応じて公開の議論で調整します

## PR レビューとマージ

- 原則: CI がすべて成功していること
- 外部コントリビューターからの PR は、メンテナによるレビュー（少なくとも 1 回の承認）後にマージします
- メンテナによる変更でも、可能な限りセルフレビューを行い、レビュー観点を PR 本文に記載します

### マージ前チェックリスト

CLAUDE.md "AI Misoperation Guards" の運用ガードのうち、PR マージ判断に直結するものを本セクションに集約します。CLAUDE.md は要旨のみを残し、詳細手順はここを正とします。

#### 1. CI green の確認

`gh pr merge` の前に `gh pr checks` を実行し、必須チェックがすべて `pass` バケットに入っていることを確認します。`fail` / `pending` / `cancel` が残るマージは不可です。

```bash
gh pr checks <N> --json name,bucket --jq '.[] | select(.bucket != "skipping")'
```

- `SKIPPED` チェックは `bucket == "skipping"` で除外できます。
- 必須チェック (`Lint`, `Unit tests` など) が pre-existing 失敗の場合も、本 PR を直接マージしてはいけません。`main` 向けの fix PR を先に出して main を green に戻し、その後本 PR をリベースしてマージします。

#### 1.1 Branch protection の概要

main ブランチには GitHub branch protection rule により以下の Required status check が設定されています（#483 で導入）。これらが `pass` でない限りマージできません。

- `Lint`
- `Unit tests (20.x)` / `Unit tests (22.x)`
- `Skill schema validation`
- `Meta consistency`
- `Action dist freshness`
- `Integration (CLI)`

`strict: true` で PR が最新 main にリベース済みであることが求められ、`enforce_admins: true` のためメンテナも bypass できません。`allow_force_pushes: false` / `allow_deletions: false` により main への force push / 削除も不可です。

現在の設定の確認:

```bash
gh api 'repos/:owner/:repo/branches/main/protection' --jq \
  '{checks: .required_status_checks.contexts, strict: .required_status_checks.strict, enforce_admins: .enforce_admins.enabled}'
```

リリース等で一時的に無効化が必要な場合は、`gh api -X PUT .../protection` でルールを編集してから実行し、終了後に再有効化します。設定の技術詳細は Issue #483 を参照。

#### 2. レビュアーコメントの確認

CI green は line-level コメント（`Copilot`, `sentry[bot]`, 人間レビュアー）を覆いません。マージ前には次節「レビュアーコメントの扱い」の手順で全件を列挙し、disposition を確定させてください。

#### 3. multi-PR 作業の preflight

複数 PR の連続マージ、main CI 失敗の修正 PR、`.github/workflows/*.yml` の `node-version` / action pin / `permissions` を変える PR など、書き込み系の handoff タスクに着手する前に `/preflight <keyword or PR numbers>` を実行し、対象タスクが既にマージ済み/obsolete/並行作業中ではないことを確認します。

- `gh pr list` は GraphQL キャッシュの影響で recently merged な PR を `open` と返すことがあります。判定には `gh api repos/:owner/:repo/pulls/{N}` (REST) を併用してください。
- 過去の累計で 1 セッション中に 4 件の重複 PR (#485, #489, #492, #496) を生んだ実績があります。

#### 4. dist 再ビルド時の Node バージョン整合

`runners/github-action/src/**` を変更した場合、または `Action dist freshness` CI が失敗した場合は、`runners/github-action/dist/` を `.nvmrc` (リポジトリ全体の SSoT) でピンされた Node バージョンで再ビルドしてください。

- `npm run build:action` は Node メジャーが異なると CI 再現性のあるアウトプットになりません。
- 切り替え例: `nvm use` (`.nvmrc` を読む) または同等の version manager コマンド。
- トラブルシュートは `docs/development/dist-check-rebuild-guide.md` を参照。

#### 5. git 出力の検証

`git commit` / `git push` / `git switch` / `gh pr merge` の直後は、出力されたブランチ名・コミットハッシュ・status 行を読み、意図したターゲットに作用したことを確認してから次のコマンドへ進んでください。曖昧な場合は `git status -sb` または `git rev-parse --abbrev-ref HEAD` で再確認します。

### レビュアーコメントの扱い

CI の成否は行単位のレビュアーコメント（`Copilot` / `sentry[bot]` などの AI レビュアー、および人間レビュアー）をカバーしません。これらは CI を失敗させないため見落としやすい一方、実バグを指摘していることがあります。マージ前には本セクションの手順で必ず列挙・評価してください。

#### 列挙コマンド

```bash
gh api --paginate 'repos/:owner/:repo/pulls/<N>/comments?per_page=100' \
  --jq '.[] | {id, in_reply_to_id, user: .user.login, path, line, start_line, original_line, commit: .commit_id, body}'
```

- `--paginate` は必須です。デフォルトの 1 ページ目は 30 件で打ち切られるため、コメント数が多い PR では見落とします。
- `per_page=100` は URL クエリに直接埋め込みます。`-F per_page=100` を指定すると `gh api` の verb が POST に切り替わり HTTP 422 が返ります。
- 複数行に紐づくコメントは `line` が終端行、`start_line` が開始行です。
- `line: null` は、後続コミットでアンカー行が消えたためコメントが outdated になっていることを示します。`commit` 値を `gh pr view <N> --json headRefOid` と突き合わせて判断してください。
- スレッド（reply 連鎖）は `in_reply_to_id` で再構成できます。

#### review summaries との違い

- Bot の個別指摘は `pulls/<N>/comments`（line comments）に入ります。
- `gh pr view <N> --json reviews,reviewDecision` はレビュー単位のサマリのみで、bot の `body` は空になることが多く、`reviewDecision` が空でも個別指摘が存在する場合があります。
- したがって review state 単体でマージ可否を判断してはいけません。

#### 各コメントの dispose

列挙したコメントはそれぞれ以下のいずれかで処理し、残件がない状態にしてからマージしてください。

1. 追従コミットで対応する（推奨）。
2. Bot 自身が follow-up で resolved を宣言している（例: sentry の `*Resolved in <sha>`）。Copilot は self-resolve しないため、Copilot の指摘は a か c で対応します。
3. 同じスレッドに reply して理由を明記する。CLI では:

   ```bash
   gh api -X POST repos/:owner/:repo/pulls/<N>/comments/<comment_id>/replies \
     -f body='<reply text>'
   ```

   `-X POST` は必須です。デフォルト verb は GET で、これは既存 reply の _一覧取得_ になり、新規 reply 作成になりません。Web UI からの reply でも構いません。

#### 関連

- River Review 利用者（レビュー対象側）から見た対応フローは `skills/midstream/gh-address-comments/SKILL.md` を参照してください。本セクションはリポジトリメンテナ視点のマージ前チェックリストです。

## Breaking change の扱い

- 破壊的変更を含む場合は、PR 本文で明示し、必要に応じて Issue へのリンクを付けてください
- 互換性に影響する変更は `CHANGELOG.md` に記載し、リリースで周知します
- バージョニングは SemVer を基本とします（v0 系では変更の性質に応じて運用します）

## Issue トリアージ（ラベル方針）

- まずは Issue テンプレートに従って情報を揃えてください
- メンテナが以下の観点でラベル付け・優先度付けします
  - 優先度: `P0`（緊急）/ `P1`（高）/ `P2`（中）
  - フェーズ: `Phase 1` / `Phase 2` / `Phase 3`（または `Backlog`）—ロードマップ上の開発段階
- ラベル一覧: [Labels](https://github.com/s977043/river-review/labels)
- Issue テンプレート: [Issue templates](https://github.com/s977043/river-review/issues/new/choose)
