# ドキュメント列挙の機械検証

`scripts/check-doc-enumerations.mjs` は、ドキュメントが書いている「列挙・件数・構成」の主張を実体と突き合わせます。単体実行は `npm run check:doc-enum` です。`npm run meta:validate` からも呼ばれるため、CI の必須チェック `Meta consistency` が落ちれば PR はブロックされます。

## なぜ script なのか

機械が検証している参照と、CI 非対象の人手の列挙とでは、陳腐化の起き方が違います。以下は 2026-08-02 時点の実測値です。**率だけでなく分子と分母を併記し、再実行できるコマンドを添えてあります。** 数値を更新するときは、同じコマンドを実行して出力から転記してください。

### 機械検証されている参照: 864 件中 0 件

lychee が検証している相対 `.md` リンクの実測です。`.github/workflows/link-check.yml` は markdown を変更した PR と週次スケジュールで走り、壊れたリンクがあればジョブが落ちます。

```bash
total=0; broken=0
while IFS= read -r src; do
  while IFS= read -r link; do
    [ -z "$link" ] && continue
    total=$((total + 1))
    [ -e "$(dirname "$src")/${link%%#*}" ] || { broken=$((broken + 1)); echo "BROKEN: $src -> $link"; }
  done < <(grep -oE '\]\([^)#:]+\.md' "$src" | sed 's/^](//' | grep -v '^/')
done < <(git ls-files '*.md' | grep -v -e '^CHANGELOG.md$' -e '^pages/index.md$' -e '^pages/index.en.md$')
echo "broken=$broken total=$total"
# 出力: broken=0 total=864
```

除外している 3 ファイルは `.lychee.toml` の `exclude_path` に対応します。

### 機械検証がなかった列挙: spec 化した 4 件のうち 2 件

PR #1726 で本 script に spec を 4 件登録した時点の、宣言側と実体の突き合わせ結果です。ずれていた 2 件は同じ PR で実測値へ直しました（`git diff d984caec^ d984caec -- <対象>` で確認できます）。

| spec の宣言側                           | 当時の宣言                                   | 実体                    | 判定 |
| --------------------------------------- | -------------------------------------------- | ----------------------- | ---- |
| `docs/skills-structure.md` のツリー件数 | upstream 46 / midstream 26 / downstream 9    | 49 / 60 / 8             | ずれ |
| `commands/README.md` の表               | 5 行（`review-team` と `setup-team` が欠落） | `commands/*.md` は 7 件 | ずれ |
| `.claude/commands/README.md` の表       | 7 行                                         | 一致                    | 一致 |
| `CLAUDE.md` の `Custom Commands` 表     | 14 行                                        | 一致                    | 一致 |

表の外にも陳腐化がありました。`.claude/commands/README.md` の散文は配布コマンドを 5 件だけ挙げており（`review-team` / `setup-team` が欠落）、同じ PR で「一覧は `commands/README.md` が正」という参照へ置き換えています。機械検証の対象は表であって散文ではないため、散文で列挙しないほうが安全です。

> 上の 2 つの節は #1726 当時の記録です。配布コマンド表を載せていた `commands/README.md` は、その後 [`distributed-commands.md`](./distributed-commands.md) へ移設しました（公式 validator が `commands/` 直下の `*.md` をすべてコマンドとして走査するため）。`distributed-commands-table` spec の宣言側も同じ移設先を指しています。

### チェックリストでは止まらなかった

`plugin-asset-registration-checklist.md` には作成時（2026-07-08, #1442）から「CLAUDE.md『Custom Commands』表と `commands/README.md` に説明を追記した」という項目がありました。それでも `commands/README.md` の行は次のとおり放置されました。

| コマンド追加                      | 行が入った日      | 欠落期間 |
| --------------------------------- | ----------------- | -------- |
| `setup-team` (2026-06-22, #1251)  | 2026-08-02, #1726 | 41 日    |
| `review-team` (2026-06-26, #1309) | 2026-08-02, #1726 | 37 日    |

このうちチェックリストが存在していたのは末尾の 25 日間です。項目があっても止まらなかったため、[improvement-flow.md](./improvement-flow.md) の「mechanical に検証できるか」という基準に従い、script と CI に倒しています。

### 「参照」を一括りにしないこと

同じ「参照」でも、対象が近い場所にあるものは自然に直ります。`npm run <script>` の散文参照 500 件を root の `package.json` と突き合わせると 6 件が未定義でしたが、内訳は設計文書中の仮想例が 4 件、fixture が 1 件、サブパッケージ側で定義されている `clean` が 1 件で、実質の陳腐化は 0 件でした。したがって「参照全体の乖離率」という単一の率は意味を持ちません。母集団ごとに分子と分母を出してください。

```bash
git ls-files -z '*.md' | xargs -0 rg --no-filename --no-line-number -o -r '$1' \
  'npm run (?:-s |--silent )?([a-z][a-z0-9:_-]*[a-z0-9])' | sort > /tmp/rr-refs.txt
node -p "Object.keys(require('./package.json').scripts).join('\n')" | sort > /tmp/rr-defined.txt
comm -23 <(sort -u /tmp/rr-refs.txt) /tmp/rr-defined.txt > /tmp/rr-undef.txt
wc -l < /tmp/rr-refs.txt                        # 分母: 500
grep -cxF -f /tmp/rr-undef.txt /tmp/rr-refs.txt # 分子: 6
```

## 作業ツリーを汚したまま数えない

上の 2 例のように、doc へ書く件数を手で測るときは、測定するディレクトリが作業ツリーだと値が汚染されます。汚染源は 3 種類あります。

| 汚染源                                   | 具体例                                                       | 既存の対処                       |
| ---------------------------------------- | ------------------------------------------------------------ | -------------------------------- |
| worktree の作業コピーを重複計上する      | `grep -r` が `.claude/worktrees/` 配下まで数える             | `git grep` を使う                |
| 追跡外ファイルを数える                   | textlint が `.gitignore` 対象の `docs/Working/` まで走査する | `scripts/count-in-clean-tree.sh` |
| 構造化データの集計を素の文字列比較で行う | YAML の引用符付きスカラーを剥がさずに `awk` で比較する       | パーサを通す（`node -e` / `yq`） |

2 番目は `git grep` では防げません。自分でディレクトリを走査するツール（textlint、`find`、`wc`）は、git の追跡状態を見ないからです。実例として #1786 では 347 件と公開した値の真値が 317 件で、差分は `docs/Working/` の 14 ファイルの混入でした。

`scripts/count-in-clean-tree.sh` は `git archive <ref>` を一時ファイルへ書き出し、`tar -x -f` で一時ディレクトリへ clean tree を展開し、そこで任意のコマンドを実行します。展開されるのは ref が追跡しているファイルだけなので、1 番目と 2 番目の汚染源が構造的に消えます。一時ディレクトリは `trap` で必ず削除されます。

展開にパイプ（`git archive | tar -x`）を使わないのは意図的です。`git archive` は tar 出力を blocking factor 20（10240 バイト）へパディングしますが、bsdtar は EOF マーカーを読んだ時点で終了でき、残りのパディングを読み捨てません。読み手が先に消えうるため、書き手が残りを書き終える前に読み手が抜けると SIGPIPE を受け、`set -o pipefail` の下ではスクリプト全体が exit 141 で落ちていました（#1838）。

この失敗は間欠的でした。どちらが先に終わるかはスケジューリング次第で、macOS では並列作業中に再現し、静穏時の逐次実行 20 回では再現しませんでした。CI の ubuntu では発現していません。**間欠的なぶん質が悪い失敗**です。失敗した実行は出力が空になるため、成功したときの値だけを見て動いていると判断してしまい、しかも失敗するのは並列で作業を回している最中だからです。

```bash
# 既定の ref は origin/main。--ref で上書きできる
scripts/count-in-clean-tree.sh -- bash -c 'find docs -name "*.md" | wc -l'
scripts/count-in-clean-tree.sh --ref HEAD -- npx textlint --no-cache 'docs/**/*.md'
```

出力は ref・解決した SHA・実行コマンド・結果・終了コードを 1 つの fenced block にまとめた、そのまま doc へ貼れる形になります。公開した数値の再現手段を読者へ残すため、件数を書くときはこのブロックごと貼ってください。

```console
# clean tree of origin/main @ e0c403914e570f6fd007cbe2f7648ec1994d3b54 (git archive; untracked/ignored files absent)
$ scripts/count-in-clean-tree.sh --ref origin/main -- bash -c 'find docs -name "*.md" | wc -l'
      81
# exit code: 0
```

注意点は 3 つあります。第 1 に、コマンドは exec されるため、パイプやリダイレクトを使う場合は上の例のように `bash -c '...'` へ包みます。第 2 に、展開先は `.git` を持たない素のディレクトリなので、`git grep` を使うなら `--no-index` が要ります。3 番目の汚染源は本 script の対象外で、パーサを通すことで別途防ぎます。

第 3 に、**パイプの終端が `wc` だと上流の失敗が exit 0 へ潰れます**。`wc` 自体は成功するため、コマンドが存在しなくても「0 件」という結果が返ります。誤った件数を防ぐために本 script を通しても、この形では失敗が 0 件として通過します。

```console
$ scripts/count-in-clean-tree.sh -- bash -c 'this-command-does-not-exist | wc -l'
bash: this-command-does-not-exist: command not found
       0
# exit code: 0
$ scripts/count-in-clean-tree.sh -- bash -c 'this-command-does-not-exist'
bash: this-command-does-not-exist: command not found
# exit code: 127
```

件数を数えるパイプには `set -o pipefail` を付けてください。

```bash
scripts/count-in-clean-tree.sh -- bash -c 'set -o pipefail; git ls-files "*.md" | wc -l'
```

## 何を検証しているか

登録内容は `scripts/check-doc-enumerations.mjs` の `DOC_ENUMERATION_SPECS` が SSoT です。初期スコープ（#1726）は、誤検出でメイン開発を止めないことを優先し、決定論で判定できる 4 件に絞ってあります。#1728 で `.github/workflows/README.md` のワークフロー一覧（`workflows-readme-table`）を追加しました。#1821 でガード台帳の照合 2 件（`claude-md-guard-ledger` / `guard-ledger-verified-by`）を足しました。#1831 でパイプライン関数の call site チェックリスト 3 件（`pipeline-callsites-*`）を足しました。#1846 で README の配布サーフェス 4 件（`readme-{ja,en}-plugin-{commands,skills}`）を足しました。#1843 で台帳 `decisions:` の対象パス 1 件（`decision-ledger-target`）をあとから足しました。現在の登録は 15 件です（`npm run check:doc-enum` の出力にある `N spec(s) checked` が実測値）。

| spec id                                   | 対象ドキュメント                                                 | 宣言側                                             | 実体                                                       |
| ----------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------- |
| `skills-stream-counts`                    | `docs/skills-structure.md`                                       | ツリー図の `# <n> スキル` コメント                 | `skills/<stream>/` の実ディレクトリ数                      |
| `distributed-commands-table`              | [`distributed-commands.md`](./distributed-commands.md)           | コマンド表の `File` 列                             | `commands/*.md`（`README.md` を除く）                      |
| `repo-dev-commands-table`                 | `.claude/commands/README.md`                                     | コマンド表の `File` 列                             | `.claude/commands/*.md`（同上）                            |
| `claude-md-command-table`                 | `CLAUDE.md`                                                      | `Custom Commands` 表の `Command` 列                | 上記 2 ディレクトリのコマンド名の和集合                    |
| `workflows-readme-table`                  | `.github/workflows/README.md`                                    | ワークフロー一覧表の `ファイル` 列                 | `.github/workflows/` 直下の `*.yml` / `*.yaml`             |
| `claude-md-guard-ledger`                  | `CLAUDE.md`                                                      | `AI Misoperation Guards` 節の `- **<見出し>**:` 行 | [`guard-ledger.yaml`](./guard-ledger.yaml) の `title` 集合 |
| `guard-ledger-verified-by`                | `docs/development/guard-ledger.yaml`                             | 各エントリの `verifiedBy` パス                     | 同じパスのうちディスク上に実在するもの                     |
| `decision-ledger-target`                  | `docs/development/guard-ledger.yaml`                             | `decisions:` 各エントリの `target` パス            | 同じパスのうちディスク上に実在するもの                     |
| `pipeline-callsites-generate-review`      | [`pipeline-params-checklist.md`](./pipeline-params-checklist.md) | `必須: generateReview` 節の `- [ ] <path>` 行      | `generateReview` / `buildPrompt` の call site ファイル     |
| `pipeline-callsites-verify-finding`       | [`pipeline-params-checklist.md`](./pipeline-params-checklist.md) | `必須: verifyFinding` 節の `- [ ] <path>` 行       | `verifyFinding` の call site ファイル                      |
| `pipeline-callsites-build-execution-plan` | [`pipeline-params-checklist.md`](./pipeline-params-checklist.md) | `必須: buildExecutionPlan` 節の `- [ ] <path>` 行  | `buildExecutionPlan` の call site ファイル                 |
| `readme-ja-plugin-commands`               | `README.md`                                                      | 「得られるもの」の `- コマンド:` 箇条書き          | `commands/*.md`（`README.md` を除く）の basename           |
| `readme-ja-plugin-skills`                 | `README.md`                                                      | 「得られるもの」の `- スキル:` 箇条書き            | `skills/agent-skills/` 直下のディレクトリ名                |
| `readme-en-plugin-commands`               | `README.en.md`                                                   | 「What you get」の `- Commands:` 箇条書き          | 同上（`readme-ja-plugin-commands` と同じ実体）             |
| `readme-en-plugin-skills`                 | `README.en.md`                                                   | 「What you get」の `- Skills:` 箇条書き            | 同上（`readme-ja-plugin-skills` と同じ実体）               |

`claude-md-guard-ledger` は、宣言側と実体側の役割が他の spec と逆になります。CLAUDE.md の編集は「Always ask」に分類されるため、[`guard-ledger.yaml`](./guard-ledger.yaml) を SSoT（実体側）とし、CLAUDE.md を従属側（宣言側）として照合します。ガードの追加・改名・削除のいずれの経路でも、台帳と CLAUDE.md を同じ PR で更新しない限りこの spec が落ちます。`guard-ledger-verified-by` は台帳の `verifiedBy` が実在しないパスを指した時点で落とします。ただし「そのパスが必須チェックに載るジョブから実行されるか」までは見ていません（実行経路の追跡は静的解析が必要なため、follow-up）。

`decision-ledger-target` は、台帳の `decisions:`（ガード以外の期限付きの決定。#1843）が挙げる `target` の実在を見ます。deprecate した資産を削除したのにエントリが残る場合と、`target` のパスを打ち間違えた場合の両方で落ちます。`decisions:` が空、またはキーそのものが無い状態は正常として扱い、マーカー消失にはしません（決定がすべて片付いた状態を表すためです）。

`pipeline-callsites-*` の 3 件は、CLAUDE.md「Propagate signatures」が参照する散文チェックリストを実体側の call site 走査と突き合わせます。パイプライン関数の呼び出し元が増えてもチェックリストへ追記されない、という陳腐化を塞ぐのが目的です。個々のパラメータが転送されているかまでは見ません（options オブジェクト 1 個で渡るため、どのキーが必須かを決定論では判定できないからです）。走査に現れない宣言や同名の別関数は `ignoreKeys` で理由付きで除外しています（`scripts/check-doc-enumerations.mjs` の `PIPELINE_IGNORE_KEYS`）。

`workflows-readme-table` は `kind: 'names'` だけを登録しています。README には「27 本」という本数の記述もありますが、names 比較は過不足の両方向を検出して件数の主張を包含するため、`kind: 'counts'` の spec は重ねて登録しません（「1 本消して 1 本足す」は counts では素通りします）。ワークフロー名・トリガー・目的・必須チェック該否の列は機械検証の対象外で、人手のままです（必須チェックの SSoT は branch protection API であり、CI からネットワークを叩かないため対象外とします）。

`readme-*-plugin-*` の 4 件は、README のインストール節「得られるもの / What you get」が書く配布サーフェス（コマンドと agent-skill）を実体と突き合わせます。README は表を持たない散文なので、`parseSurfaceBulletNames` が「節の目印行 → 箇条書きのラベル → 名前の形」の 3 点で対象を絞ります。名前の形に合わないコードスパンは無視するため、呼び出し方の説明にある `/river-review:<skill-name>` のようなプレースホルダは列挙として数えません。目印行かラベル行が消えた場合はマーカー消失としてエラーになります。#1846 以前は、この列挙がどの機械検証にも載っておらず、コマンド 2 件（`setup-team` / `review-team`）と skill 3 件（`river-review-frontend` / `review-team` / `unknown-coverage-review`）の欠落が残っていました。

既存チェックとの重複は避けています。`CLAUDE.md` の「Details: distributed commands (...)」という散文は、すでに機械検証の対象です。担当は `scripts/validate-plugin-manifest.mjs` の `checkClaudeMdCommandParity` であり、`.claude-plugin/plugin.json` の `commands[]` と突き合わせます。本 script が受け持つのは `Custom Commands` の**表**であって、散文ではありません。

## 列挙を書いたときの手順

1. その列挙が機械で数えられるか確かめる。数えられないなら、そもそも件数を書かない選択も検討する
2. `DOC_ENUMERATION_SPECS` に spec を 1 件追加する。`declare`（doc から宣言値を取り出す純関数）と `measure`（実体を数える関数）の組で表現する
3. 上の「何を検証しているか」の表にも同じ spec の行を足す。この表は自己検証の対象外なので、手で揃える必要がある
4. `npm run check:doc-enum` を実行し、追加した spec が現状で green になることを確認する
5. `tests/check-doc-enumerations.test.mjs` に「実 doc を 1 箇所だけ壊すと落ちる」テストを足す。偽 spec だけで固めると、`declare` が別の表を掴んでいても集合が一致すれば通ってしまう
6. 同ファイルの「passes on the current repo state」が通ることを `npm test` で確認する

spec の型は次の 2 種類です。

- `kind: 'counts'`—キーと数値の `Map` を突き合わせる。件数の主張に使う
- `kind: 'names'`—名前の `Set` を突き合わせる。一覧表の主張に使う。過不足の両方向を報告する

宣言側のマーカー（表や行）が見つからない場合は、一致ではなく**エラー**として扱います。regex がすり抜けて検証が空振りする状態は、落ちるよりも危険だからです。これは `validate-meta-consistency.mjs` が `extractLatestRelease` の `null` をエラー化しているのと同じ設計です。

同じ理由で、次の状態もエラーになります。

- **1 件も検証していない**（全 spec が ignore またはスキップされた）。「落ちないが何も守っていない」状態を OK にはしない
- **同一キーの宣言が重複している**。`docs/skills-structure.md` のようにツリーが複数ある doc では、後勝ちにすると読者が最初に見るツリーが陳腐化しても通ってしまう
- **`kind` が `'counts'` / `'names'` 以外**。typo が黙って別の比較経路に落ちるのを防ぐ
- **`declare` が throw した**。1 つの spec の失敗で全 spec が巻き添えにならないよう、spec 単位で捕捉して報告する

## 除外の使い方

意図的に概数で書きたい箇所や、まだ実体が揃っていない項目は除外できます。除外は 2 通りあり、いずれも理由の記述が必須です。

### 1. doc 側のインラインコメント（spec 全体を除外）

対象ドキュメントの本文に次のコメントを置くと、その spec の検証をスキップします。

```html
<!-- doc-enum:ignore <specId> -- 理由をここに書く -->
```

理由を省いた `<!-- doc-enum:ignore <specId> -->` はエラーになります。理由なしの黙殺を作らないための仕様です。

### 2. spec テーブル側の allowlist（キー単位で除外）

一覧のうち特定の項目だけを対象外にしたい場合は、spec に `ignoreKeys` を書きます。キーが項目名、値が理由です。

```js
{
  id: 'distributed-commands-table',
  // ...
  ignoreKeys: { 'experimental.md': '実験中のため意図的に未掲載' },
}
```

値が空文字や文字列以外の場合はエラーになり、その除外は採用されません。該当キーは通常どおり比較されるため、理由なしの除外で検証が空振りすることはありません。

宣言側と実体側のどちらにも現れないキーの除外は、期限切れとみなしてエラーになります。除外キーは両側をマスクするため、そのまま残すと、対象ファイルが将来復活しても永久に検査されないからです。

## 誤検出が出たとき

false positive でメイン開発を止めないことを最優先とします。対処の優先順は次のとおりです。

1. spec の `declare` / `measure` を直して、正しく判定できるようにする
2. すぐ直せないなら `doc-enum:ignore` か `ignoreKeys` で理由付きの除外を入れ、issue を立てる
3. 対象そのものが機械検証に向いていないと判明したら、spec を削除する

## 関連

- `scripts/check-doc-enumerations.mjs`—spec テーブル本体と検証エンジン
- `tests/check-doc-enumerations.test.mjs`—パーサーと除外機構の回帰テスト
- `scripts/count-in-clean-tree.sh`—clean tree で件数を測るヘルパー（`tests/count-in-clean-tree.test.mjs` が回帰テスト）
- [`guard-ledger.yaml`](./guard-ledger.yaml)—AI Misoperation Guards の台帳（`claude-md-guard-ledger` の実体側）
- `scripts/validate-plugin-manifest.mjs`—plugin manifest 側の列挙検証（`Meta consistency` で併走）
- [`sidebar-reachability-check.md`](./sidebar-reachability-check.md)—公開ページの sidebar 到達性検証（`meta:validate` で併走、#1727）
- [`improvement-flow.md`](./improvement-flow.md)—再発防止策を script と CI に倒す判断基準
- [`plugin-asset-registration-checklist.md`](./plugin-asset-registration-checklist.md)—コマンド追加時の登録手順
