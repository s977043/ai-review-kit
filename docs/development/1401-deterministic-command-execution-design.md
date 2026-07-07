# deterministicGate.command 安全実行機構の設計（#1401）

> Status: Design（設計のみ・実装未着手）。本ドキュメントは #1401 の 6 タスクを具体化する設計であり、
> コード実装は伴わない。実装 PR はこの設計を DoD として参照する。
>
> **敵対的セキュリティレビュー結果（assume-breach）: CONDITIONAL / 67 点**。
> 6 機構は層状で fail-safe 方向は一貫するが、中核防御（機構 1 trusted-ref pin + 機構 2 allowlist）が
> canonical 例 `npm run lint:ci` によって二重に骨抜きになる。実装前に次の 3 ブロッカーを設計で確定すること。
>
> 1. **ゲート健全性の崩壊を「未確定」で流さない**: allowlist に載せた command の実体（`package.json`
>    scripts / tsconfig・eslintrc 等の config autoload）は PR head 制御。`exit 0` に書換れば
>    決定論ゲートが常時グリーンになり、RCE 以前に**ゲートが権威たり得ない**。Phase 1 の allowlist は
>    「PR head の設定・スクリプト・`node_modules` を一切読まない自己完結 command（絶対パス・config
>    autoload 無効）」に限定し、素の `npm`/`npx`/`bash`/`node` 登録を schema/実装で拒否する。
> 2. **on-disk secret の遮断**: `actions/checkout` 既定（`persist-credentials: true`）で GITHUB_TOKEN が
>    `.git/config` に永続化され、env スクラブを迂回して読める。`persist-credentials: false`、`.git` を
>    晒さない clean cwd、`HOME` を空一時ディレクトリへ差し替え（現 SAFE_ENV は本物の `$HOME`＝`~/.aws`
>    等が見える）。
> 3. **stdout / findings の exfil チャネルを閉じる**: レビュー対象を `~/.aws` 等へ symlink すると
>    linter が読み PR コメント/findings へ露出。command は symlink 追跡せず、stdout を PR へ生出力せず
>    判定は exit code のみとする。DoS の 1 MiB 上限は機密性を守らない。
>
> 詳細は §6（残る攻撃面）に反映済み。**この 3 点が設計で解決されるまで実装しない。**

## 1. 背景と本ドキュメントの位置づけ

Epic #1347 S4（#1351）で `deterministicGate.command` の**任意コマンド実行は RCE 面**であると判明し、
S4 では command 実行を descope した。strict_block ルーティングは既存 finding 入力ベース
（`src/lib/deterministic-gate.mjs` の `computeStrictBlock`）で実装済みであり、command を実際に
子プロセスとして起動する機構は**まだ存在しない**。

現状の到達点は次のとおりである。

- `schemas/skill.schema.json` の `deterministicGate` は `command`（string, minLength 1）と
  `failSeverity`（`strict_block` | `bypass_warning`, default `strict_block`）を宣言のみで定義する。
  同スキーマの `description` は明示的に「`command` is an arbitrary command specified by a repo-owned
  file—the agent under review can edit it」と TRUST BOUNDARY を警告している。
- `src/lib/skillYamlSchema.mjs` の zod 側 `deterministicGate` も同形で `.strict()` 付き（#1399 の
  skill-schema-parity canary が ajv 側 `additionalProperties: false` との整合を守る）。
- `src/lib/gate-decision.mjs` の `deriveGateDecision` は純関数で、`strictBlock === true` を
  受け取ると rule 5b で無条件 `NO_GO`（reasonCode `STRICT_BLOCK`）に倒す。rule 0（`.river/**` 変更は
  無条件 `ESCALATE`）が唯一の in-contract な trust boundary 防御である。
- ADR-003 は「リスクマップ・config・plan テキストは被レビュー変更の著者（=エージェント）の書き込み
  権限下にあり、gate は host / CI checkout で導出されて初めて信頼できる」と明記し、
  `skills/**` の `deterministicGate.command` 実行を「広い攻撃面」として本 issue（#1401）に委ねている。

つまり本設計の中心課題は、「**被レビュー PR 著者の書き込み権限下にある command 文字列を、
CI の secret を守りながら決定論ゲートとして安全に実行する**」ことである。

## 2. 脅威モデル

### 2.1 攻撃者の能力

攻撃者は**被レビュー PR の著者**である。fork からの PR を含む。攻撃者は次を制御できる。

- `skills/**/SKILL.md`（および skill が読む付随ファイル）の内容全体。したがって
  `deterministicGate.command` / `args` の値、`evaluationType`、`failSeverity` を任意に書ける。
- 被レビューツリー（PR head）配下の任意ファイル。`package.json` の `scripts`、
  `Makefile`、`node_modules` に混入させたバイナリ、リポジトリ内の任意スクリプトを含む。
- PR の diff がゲート判定へ与える入力の一部（ただし gate-decision 自体は host 側で導出される）。

攻撃者が制御**できない**もの（信頼境界の外側 = host / CI 側）。

- base ref（`main` / protected branch）のツリー内容。branch protection により PR は base を
  直接書き換えられない。
- CI ランナー上の環境変数（`GITHUB_TOKEN`、OIDC 経由のクラウド資格情報、`RIVER_*` secret 等）。
- River Review 本体のコード（`src/**`、`runners/github-action/**`）。ただしこれ自体を PR で
  書き換える攻撃は別途 CODEOWNERS / required review で守る前提とする（本設計のスコープ外）。

> **脅威強度の訂正（敵対レビュー）**: 現行 `.github/workflows/plangate-review.yml` は
> `on: pull_request`（`pull_request_target` ではない）で `permissions: contents:read /
pull-requests:write`。したがって **fork PR には secret が注入されず `GITHUB_TOKEN` は read-only**。
> 最悪ケース（secret 有り + 書込トークン）が成立するのは主に **same-repo ブランチ（＝collaborator）**。
> 本設計は保守的に一括「攻撃者」として扱うが、「fork でも token write」という想定は実構成より過大。
> ただし same-repo ブランチ経由の secret 窃取は現実的脅威として残るため、防御の必要性は変わらない。
> なお same-repo PR では既に `npm ci` と `node -e "require('./plan.json')"` が PR head で走るため、
> deterministic-exec 以前に npm ライフサイクルスクリプト経由の RCE 面が既存である点も併記する
> （本機構はその面を拡大しないことが最低条件）。

### 2.2 保護資産

1. **CI ランナー上の secret**: `GITHUB_TOKEN`（same-repo ブランチ構成では write 権限を持ちうる）、
   クラウド資格情報、レジストリトークン。**env 経由だけでなく on-disk（`.git/config` の永続化
   token、`$HOME` 配下の `~/.aws` 等）と stdout/findings 経由の外部送信も**防ぐ（後者2つは
   敵対レビューが env スクラブの構造的迂回として指摘）。
2. **CI 実行環境の完全性**: 任意コード実行（RCE）そのもの。攻撃者が CI 上で任意プロセスを
   起動できること自体を最小化する。
3. **ゲート判定の健全性**: 攻撃者が `command: "true"` 等でゲートを常時グリーン化して
   strict_block を無効化できないこと（判定の integrity）。
4. **可用性**: NO_GO ストーム（全 PR 巻き込みブロック）や DoS（無限ループ command、巨大 stdout、
   fork 爆弾）で正当な PR がブロック/停止されないこと。

### 2.3 信頼境界（trust boundary）

```text
         ┌─────────────────────────────────────────────┐
         │  信頼境界の外側 = agent 書込権限外            │
         │  ・base ref (main) のツリー                   │
         │  ・CI env (GITHUB_TOKEN, cloud creds)         │
         │  ・River Review 本体 (src/**)                 │
         │  ・host が解決する allowlist / trusted config │
         ├─────────────────────────────────────────────┤
         │  信頼境界の内側 = 被レビュー PR 著者が制御    │
         │  ・skills/**/SKILL.md (command/args/gate)     │
         │  ・PR head ツリー全体 (package.json 等)       │
         │  ・.river/** (PR は書けるが rule 0 で検出)    │
         └─────────────────────────────────────────────┘
```

設計の全ハードニングは「**command の定義と、実行される中身の双方を、可能な限り信頼境界の外側の
値で pin する**」ことに帰着する。execFile（shell 非経由）は「信頼コマンドへの引数注入」しか防がず、
command 文字列そのものが攻撃者制御という本脅威には無力である点を最初に確認しておく。

## 3. 設計判断（6 機構）

### 3.1 機構 1: trusted-ref pin

**方針**: 実行対象の command 定義（および allowlist）を、PR head ツリーではなく
**base ref（`main` / protected branch）の checkout から解決**する。PR head の
`skills/**/SKILL.md` が書き換えた `command` / `args` は**実行判定に一切用いない**。

具体機構は次のとおり。

1. CI が base ref を明示 checkout する。GitHub Actions では `pull_request` イベントの
   `github.event.pull_request.base.sha` を `actions/checkout` の別 path へ取得し、
   River Review に `RIVER_TRUSTED_TREE=<base checkout path>` として渡す。
2. deterministic 実行器は skill メタデータのうち **command/args/allowlist に関わる部分を
   `RIVER_TRUSTED_TREE` 側からのみ読む**。被レビュー対象の diff / ファイル内容
   （command が lint する対象）は PR head ツリーから読むが、**何を実行するか**は base 側で決まる。
3. host（CI）ツリーと PR ツリーを物理的に別ディレクトリに分離し、実行器は「実行定義の出所」と
   「レビュー対象の出所」を混同しない。base に存在しない skill id の command 実行は拒否する
   （新規 skill を PR で持ち込んで即実行させる経路を塞ぐ）。

**トレードオフ**: PR が新しい deterministic skill を追加しても、その command はマージされて
base に入るまで実行されない。これは意図的な制約であり、「新しい実行コードは人間レビューを経て
base に入る」という不変条件と一致する。skill の追加自体は agentic/heuristic レビューで
評価されるため、レビュー機能が失われるわけではない。

**却下した代替案**:

- _署名済み ref のみ許可（GPG/sigstore 署名 commit の command のみ実行）_: 最も強力だが、
  署名鍵運用・検証パイプラインの導入コストが大きく、opt-in の初期段階には過剰。将来の
  拡張ポイントとして残す（§7 段階導入 Phase 3）。
- _PR head の command を実行しつつ diff で command 変更を検出したら ESCALATE_: 検出漏れ
  （難読化・間接呼び出し）に弱く、fail-open になりやすい。base pin の方が構造的に堅い。

### 3.2 機構 2: 実行 allowlist

**方針**: 自由文字列の command 実行を全面禁止し、**host が信頼するリポジトリ側の
allowlist に登録された command のみ**実行する。allowlist に無い command を宣言した
deterministic skill は「実行不能」として扱い、strict_block を発火させず reasonCode で可視化する
（§3.5 の `DETERMINISTIC_UNRUNNABLE` 寄り）。

**allowlist の置き場所**: `.river/deterministic-allowlist.yaml`（`.river/` 配下）とする。

- `.river/**` は gate-decision.mjs rule 0 の保護領域であり、PR が allowlist を書き換えると
  **その diff 自体が無条件 `ESCALATE`（`GATE_CONFIG_CHANGED`）を発火**する。つまり
  「allowlist を緩めて悪意ある command を通す」PR は必ず人間承認に回る。これが
  「allowlist を PR が書き換えられるなら意味がない」という論点（§6 で再掲）への構造的回答である。
- ただし rule 0 は「gate 判定を host 側で導出する」ことが前提。したがって allowlist の
  **読み取りも `RIVER_TRUSTED_TREE`（base checkout）側から行う**（機構 1 と一体）。PR head の
  allowlist は実行判定に使わない。rule 0 は「気づける」保証、trusted-ref pin は「そもそも
  PR 版を使わない」保証で、二重防御にする。

**形式（案）**: 実行可能な argv を**完全一致**で列挙する。glob やワイルドカードは
入れない（部分一致は攻撃面を広げる）。

```yaml
# .river/deterministic-allowlist.yaml
version: 1
commands:
  - command: npm
    args: ['run', 'lint:ci']
  - command: npx
    args: ['tsc', '--noEmit']
```

**照合方法**: skill の `deterministicGate.{command,args}`（base 側から解決した値）を
allowlist のエントリと**構造的完全一致**（command 文字列一致 かつ args 配列の要素ごと一致）で
突合する。一致しなければ実行しない。

**却下した代替案**:

- _command を allowlist の「名前」で間接参照（`command: lint` → allowlist が実体を定義）_:
  一段安全だが schema の後方互換を大きく壊す。argv 完全一致方式で十分な強度が得られるため見送る。
- _allowlist を CI の env / workflow に置く_: workflow は base で保護されるが、リポジトリ利用者が
  River Review 導入時に毎回 workflow を書く負担が増える。`.river/` 配下 + rule 0 保護が
  River Review の既存 trust モデルと一貫する。

### 3.3 機構 3: env スクラブ

**方針**: 子プロセスへ**明示 allowlist した環境変数のみ**を渡す。`process.env` を継承させない
（`spawn` の既定である env 継承を無効化する）。

**構築方法（案）**: 実行器は空の env から始め、実行に最低限必要な変数だけを積む。

```js
// 概念コード（実装時の指針。本ドキュメントでは実装しない）
// HOME は「実 $HOME をコピーしない」。~/.aws・~/.npmrc・~/.git-credentials 等の
// on-disk secret を晒さないため、空の一時ディレクトリを HOME として与える（ブロッカー 2）。
const SAFE_ENV_ALLOWLIST = ['PATH', 'LANG', 'LC_ALL', 'TZ']; // HOME/NODE_OPTIONS は含めない
const childEnv = { HOME: freshEmptyTempDir() };
for (const k of SAFE_ENV_ALLOWLIST) {
  if (process.env[k] !== undefined) childEnv[k] = process.env[k];
}
// GITHUB_TOKEN / AWS_* / *_SECRET / *_TOKEN / NODE_OPTIONS 等は一切継承しない
```

- **denylist ではなく allowlist**。`GITHUB_*` を除去する denylist 方式は新種の secret 変数名
  （`VERCEL_TOKEN` 等）に追随できず fail-open になる。既定は空で、必要分だけ足す。
- **`HOME` は実 `$HOME` をコピーしない**（ブロッカー 2 と整合）。`~/.aws` / `~/.npmrc` /
  `~/.git-credentials` 等の on-disk secret を子プロセスに晒さないため、空の一時ディレクトリを
  HOME として渡す。`NODE_OPTIONS`（`--require ./evil.js` 等の実行時コード注入）も allowlist に
  含めない。
- allowlist するキー集合は host 設定（`.river/deterministic-allowlist.yaml` の
  トップレベル `env:` 等）で拡張可能にするが、**既定に secret 系は一切含めない**。
- `PATH` は必要だが、これ自体が「PATH 上の悪意あるバイナリ実行」経路になりうる（§6 残攻撃面）。
  機構 1 の base pin と機構 2 の allowlist で「何を起動するか」を縛ることで緩和する。

**却下した代替案**: _env をそのまま渡し、command 側で secret を使わない規約にする_—規約は
攻撃者が破るので不可。スクラブは機械的強制でなければ意味がない。

### 3.4 機構 4: argv 契約

**方針**: schema を `command`（文字列）+ `args`（文字列配列, optional）に変更し、
**`execFile`（shell 非経由）**で実行する。Codex 指摘のとおり、単一文字列 `"npm run lint"` を
execFile にそのまま渡すと `"npm run lint"` という 1 つの実行ファイル名として解釈され壊れる。

**schema 変更案（後方互換）**: §4 に詳細。要点は次のとおり。

- `args`（`type: array, items: string`）を追加する。
- 既存の単一文字列 `command`（`"npm run lint"` 形式）は**後方互換のため受理するが、
  実行はしない**扱いとする。具体的には「`args` 未指定 かつ `command` に空白を含む」command は
  「argv 形式未移行」として実行不能（`DETERMINISTIC_UNRUNNABLE` 相当）にし、警告で移行を促す。
  これにより「文字列を shell で分割実行」という危険なフォールバックを**作らない**。
- shell は一切経由しない（`shell: false`、execFile 既定）。

**却下した代替案**: _`command` 文字列を空白で split して argv 化_—クォート・変数展開の
解釈が曖昧で、`;` `&&` `$()` 等を含む文字列の扱いが実装依存になる。明示 `args` を必須方向に
倒す方が安全。

### 3.5 機構 5: spawn error / timeout の区別

**方針**: 「**command が違反を検出して非ゼロ終了した**（= レビュー上の違反）」と
「**command を実行できなかった**（= 環境障害 / 設定不備）」を別 reasonCode に分離する。
前者のみ strict_block（`NO_GO`）に倒し、後者は `ESCALATE` 寄り（人間へ）に倒す。

理由は #1401 の敵対レビュー④で挙がった **NO_GO ストーム**の回避である。allowlist に載った
command が CI の一時障害（ネットワーク断・依存未インストール・timeout）で実行不能になると、
それを「違反」と解釈すれば**全 PR が一斉に NO_GO でブロック**される。実行不能は「判定できない」
であり、fail-safe の方向は「人間に上げる（ESCALATE）」であって「機械的にブロック（NO_GO）」ではない。

**区別の判定基準（案）**:

| 事象                                            | 分類                      | gate 方向                      |
| ----------------------------------------------- | ------------------------- | ------------------------------ |
| command 起動成功・exit code 非ゼロ              | 違反                      | `NO_GO`（`STRICT_BLOCK`）      |
| command 起動成功・exit code 0                   | パス                      | ブロックしない                 |
| ENOENT（実行ファイル無し）/ EACCES / spawn 失敗 | 実行不能（設定/環境障害） | `ESCALATE`                     |
| timeout（§3.6 の上限超過で kill）               | 実行不能（判定不可）      | `ESCALATE`                     |
| allowlist 不一致で実行せず                      | 実行不能（設定不備）      | `ESCALATE` 寄り（§6 で要検討） |

**reasonCode 追加案**: §5 参照。中心は `DETERMINISTIC_UNRUNNABLE`（実行不能 → ESCALATE）を
新設し、既存 `STRICT_BLOCK`（違反 → NO_GO）と分ける。

**却下した代替案**: _実行不能も NO_GO にして「安全側」とする_—一見 fail-safe だが、
可用性を破壊し（NO_GO ストーム）、かつ攻撃者が「わざと実行不能にして特定 skill の
strict_block を回避」する余地を残す。ESCALATE（人間判断）が真の fail-safe。

### 3.6 機構 6: DoS 制限（stdout 上限・timeout・プロセス数）

**方針**: 子プロセスに資源上限を課し、悪意ある command による CI の枯渇を防ぐ。具体値は初期案
（host 設定で上書き可能）とする。

| 制限項目              | 初期値（案）                                     | 超過時の扱い                                            |
| --------------------- | ------------------------------------------------ | ------------------------------------------------------- |
| 実行 timeout          | 60 秒 / command                                  | kill（SIGKILL）→ `DETERMINISTIC_UNRUNNABLE`（ESCALATE） |
| stdout/stderr 上限    | 各 1 MiB                                         | 超過分を打ち切り、キャプチャを停止                      |
| 同時実行プロセス数    | 1（逐次実行）                                    | 並列化は将来拡張。まず逐次で単純化                      |
| 総 command 実行数     | selected skill 数上限（既存の skill 上限に従う） | 上限で打ち切り                                          |
| プロセスグループ kill | detached + 負 PID kill                           | timeout 時に子孫プロセスごと終了                        |

- `execFile` の `timeout` + `maxBuffer` を第一の防御にする（`git.mjs` は既に `maxBuffer:
200MB` を使うが、こちらは攻撃者制御なので**逆に小さく**する）。
- timeout kill は子プロセスだけでなく**プロセスグループ全体**を対象にする（fork した子孫が
  残るのを防ぐ）。`spawn` の `detached: true` + `process.kill(-pid)` を想定。**移植性の注意
  （gemini #1423）**: 負 PID によるプロセスグループ kill は POSIX 前提で、Windows では未対応。
  River Review の CI は `ubuntu-latest`（Linux）だが、実装は「Linux 前提・Windows では
  プロセスグループ kill を行わず timeout 単体にフォールバック」を明示する。`setsid` で pgid を
  変える子には `kill(-pid)` が届かない点も残攻撃面（§6.8 Low）として既知。
- fork 爆弾・メモリ枯渇の完全防御は Node 単体では困難であり、CI ランナー側の cgroup /
  コンテナ資源制限に依存する部分が残る（§6 残攻撃面）。

**却下した代替案**: _無制限 + CI 全体 timeout に委ねる_—1 command の暴走が review 全体を
道連れにし、原因特定も困難。command 単位の上限が必要。

## 4. schema 変更案（ajv + zod, 後方互換）

### 4.1 ajv（`schemas/skill.schema.json`）

`deterministicGate` に `args` を追加する。`additionalProperties: false` は維持。

```json
{
  "deterministicGate": {
    "type": "object",
    "additionalProperties": false,
    "required": ["command"],
    "properties": {
      "command": { "type": "string", "minLength": 1 },
      "args": {
        "type": "array",
        "items": { "type": "string" },
        "description": "argv (shell 非経由 execFile)。command は実行ファイル名、args がその引数。"
      },
      "failSeverity": {
        "type": "string",
        "enum": ["strict_block", "bypass_warning"],
        "default": "strict_block"
      }
    }
  }
}
```

### 4.2 zod（`src/lib/skillYamlSchema.mjs`）

`.strict()` を維持したまま `args` を足す（#1399 の parity canary が両者一致を守る）。

```js
deterministicGate: z
  .object({
    command: z.string().min(1),
    args: z.array(z.string()).optional(),
    failSeverity: z.enum(['strict_block', 'bypass_warning']).default('strict_block'),
  })
  .strict()
  .optional(),
```

### 4.3 後方互換の扱い

- `args` は optional。既存 skill（`args` 無し）は schema 検証を通る（破壊的でない）。
- **実行意味論**の後方互換は「受理するが実行しない」で担保する。`args` 未指定かつ `command` に
  空白を含む（旧来の `"npm run lint"` 形式）skill は schema 上は valid だが、実行器が
  「argv 未移行」と判断して実行せず `DETERMINISTIC_UNRUNNABLE` を出す。これにより
  「schema は通るのに危険な shell 分割実行にフォールバックする」事態を回避する。
- parity canary（skill-schema-parity, #1399）と、`deterministicGate` を含む fixture の
  期待値更新を同一 PR で行う（CLAUDE.md「Skill-check fixture/description drift」ガード）。

## 5. reasonCode 追加案（`src/lib/gate-decision.mjs`）

`GATE_REASON_CODES` に実行不能系コードを追加する。fail-safe 方向（不明/未決は GO でなく
NO_GO/ESCALATE）を厳守する。

| 新 reasonCode              | decision   | 意味                                                                                                                |
| -------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------- |
| `DETERMINISTIC_UNRUNNABLE` | `ESCALATE` | deterministic command が実行不能（spawn 失敗 / timeout / allowlist 不一致 / argv 未移行）。判定できないので人間へ。 |

- 既存 `STRICT_BLOCK`（`NO_GO`, rule 5b）は「command が違反を検出」の場合に限定する。
- `DETERMINISTIC_UNRUNNABLE` は escalation cliffs（rule 0-4）より後、`STRICT_BLOCK`（rule 5b）
  より**前**か後かを設計時に確定する。案: **rule 5b の直後**に置く。理由は「実行不能は違反確定より
  弱い情報」だが「NO_GO より保守的な ESCALATE」であり、cliffs(0-4) の下・STRICT_BLOCK の直後で
  「違反が確定した command はブロック、確定しない（実行不能）command は人間へ」という順序が自然。
  ただし「同一 run に strict_block 違反あり + 別 command 実行不能」の合成時の優先順位は
  §6 の未解決論点として実装時に確定する。
- 入力側は `deriveGateDecision` に新パラメータ（例 `deterministicUnrunnable: boolean` と
  対象 skill id 群）を追加する。`computeGateInputsHash` の `FIELDS` へ追加する際は、
  既存の `strictBlock` と同じく「真のときだけ canonical に足す」方式で pre-existing fixture の
  hash churn を避ける（gate-decision.mjs の既存コメント参照）。
- パラメータ伝播は CLAUDE.md「Propagate signatures」/ `docs/development/pipeline-params-checklist.md`
  に従い、`deriveGateDecision` の全呼び出し箇所を洗う。

## 6. 残る攻撃面 / 未解決論点

正直に列挙する。本設計は攻撃面を**縮小**するが**ゼロにはしない**。

1. **allowlist 自体の trust（最重要）**: allowlist を `.river/` に置き rule 0 で「PR による
   書き換えを検出」するが、rule 0 は host 側で gate を導出して初めて機能する。allowlist の
   **読み取りを base checkout から行う**設計（機構 1・2 一体）を守らないと、PR head の
   allowlist を読んでしまい防御が崩れる。実装で最も間違えやすい箇所であり、canary で固定する。
2. **allowlist 内 command の中身は依然 PR 制御**: `npm run lint:ci` を allowlist しても、
   PR head の `package.json` の `scripts.lint:ci` は攻撃者が書ける。つまり「起動する入口」は
   base で pin できても、「入口の先で走るスクリプト」は PR ツリー側になりうる。緩和策の候補:
   (a) command が読むスクリプト定義も base 側に強制する、(b) allowlist を「PR ツリーで一切
   スクリプトを間接実行しない自己完結 command」に限る運用規約。**本設計では未確定**。実装前に
   この論点を潰さないと trusted-ref pin が骨抜きになる。
3. **PATH 経由バイナリ**: env allowlist に `PATH` を残す以上、PATH 上に PR が置いたバイナリ
   （`node_modules/.bin/` 等）を起動する余地が残る。絶対パス強制や PATH を base ツールチェーンに
   限定する案があるが、実用性とのトレードオフで未確定。
4. **NO_GO ストーム vs 実行不能の悪用**: 実行不能を ESCALATE に倒す（機構 5）と、攻撃者が
   「わざと timeout / spawn 失敗を起こして特定 skill の strict_block を回避しつつ ESCALATE で
   人間の目には触れる」挙動を作れる。ESCALATE は人間が見るので致命ではないが、常態化した
   ESCALATE はラバースタンプ化を招く（ADR-003 の懸念そのもの）。実行不能の頻度を digest で
   監視する運用が要る。
5. **strict_block と unrunnable の合成優先順位**: 同一 run で「skill A が違反（NO_GO 相当）」
   かつ「skill B が実行不能（ESCALATE 相当）」のとき、どちらを優先するか。ESCALATE の方が
   保守的なので ESCALATE 優先が素直だが、「違反が既に確定しているのに実行不能を理由に
   人間承認へ格上げ」が妥当かは要議論。§5 で rule 順を確定する。
6. **fork 爆弾 / メモリ枯渇**: Node の timeout / maxBuffer では防ぎきれない。CI ランナーの
   cgroup / コンテナ資源制限に依存する部分が残る。River Review 単体では完全防御できない旨を
   ドキュメントで明示する必要がある。
7. **base に悪意ある command をマージさせる経路**: trusted-ref pin は「base は信頼できる」を
   前提にする。base 自体に悪意ある command を仕込む PR がマージされれば防御は無効。これは
   CODEOWNERS / required human review（`.river/**` と `skills/**` の deterministic 追加を
   人間レビュー必須にする branch protection）で守る前提であり、本設計のスコープ外だが**前提条件
   として明記が必須**。

### 6.8 敵対レビューが追加した攻撃面（実装前に潰す）

上記に加え、assume-breach レビューが env スクラブ／argv 契約を**構造的に迂回する**面を指摘した。
論点 2 は「ゲート健全性の崩壊」であり、RCE 以前に決定論ゲートを無意味化するため**最重要ブロッカー**へ格上げする（本 doc 冒頭の Status ボックス参照）。

- **[格上げ] ゲート健全性の崩壊（論点 2 の再分類）**: `npm run lint:ci` を allowlist しても、
  script 本体（`package.json` の `scripts.lint:ci`）を PR head が `exit 0` に書換れば決定論ゲートが
  常時グリーン化する。これは secret 窃取以前に**保護資産 #3（ゲート integrity）の直接崩壊**。
  → Phase 1 は「PR head の設定・スクリプト・`node_modules` を一切読まない自己完結 command」に限定し、
  素の `npm`/`npx`/`bash`/`node`/`sh` の allowlist 登録を schema/実装で拒否する。
  **「自己完結 command」の定義（ブロッカー 1 の解決方向、gemini #1423）**: 実装前に次のいずれかで
  具体化する。(a) allowlist の command を**絶対パスのバイナリ**に限り、`args` に `-e`/`-c`/`run`/
  `exec` 等のコード・スクリプト間接実行フラグを禁止する静的検査を入れる。(b) 実行時に config
  autoload を無効化する（`--no-config` 相当・`NODE_OPTIONS` 除去・`HOME`/`cwd` 分離で PR head の
  `tsconfig`/`.eslintrc`/`.npmrc`/`.git/hooks` を読ませない）。(c) どうしても `npm run` 系が要る
  ユースケースは、script 本体も `RIVER_TRUSTED_TREE`（base）から解決する第2段の pin を課す。
  実用性（多くの lint/test は config を読む）と安全性のトレードオフが大きいため、**Phase 1 の
  対象 command を「config 非依存の自己完結チェッカー」に絞る運用規約から始める**のが現実的。
- **[High・新規] on-disk GITHUB_TOKEN 露出**: `actions/checkout` 既定 `persist-credentials: true` は
  token を `.git/config` の `http.<host>.extraheader` に書く。cwd=PR head の command は `git config`
  / `.git/config` 読取で env スクラブを迂回して token を取得できる。→ command を走らせる checkout は
  `persist-credentials: false`、command cwd に `.git` を晒さない分離が必須。
- **[High・新規] レビュー対象 symlink → stdout/findings 経由 exfil**: PR が lint 対象を
  `~/.aws/credentials` や `/proc/self/environ` への symlink にすると、linter が中身を読んで stdout に
  出力し、それが capture され `pull-requests:write` の PR コメントへ載って外部露出する。env スクラブと
  DoS 上限（1 MiB）は機密性チャネルを塞がない（secret は 1 MiB 未満）。→ command は symlink 非追跡、
  stdout を PR/findings に生出力せず判定は exit code のみ。
- **[Med・新規] config autoload クラス**: §6.2 は `scripts` に限定するが、実際は cwd から自動ロード
  される一切の設定（`.npmrc`, `tsconfig extends`, eslint plugin/parser, jest/vitest config, prettier
  plugin, `.git/hooks`）が RCE 経路。`npx tsc`/`eslint` を許すと package.json を触らず RCE。
- **[Med・新規] base-pin の path 解決 TOCTOU / skill-id 同定**: PR head skill の `..`/symlink や id
  衝突で「PR head 定義を base 承認扱い」にする実装ミスパターン。canary は「値が base 由来か」は守るが
  path traversal 角度は別途固定が要る。
- **[Low・新規] setsid による pgroup 回避 / same-repo cache poisoning**: 子が `setsid` で pgid を
  変えると `kill(-pid)` を回避。`actions/cache` の base scope を悪意 same-repo ブランチが汚染し得る。

**env allowlist の追加注意**: `NODE_OPTIONS`（`--require ./evil.js`）等の実行時コード注入変数を
allowlist に**絶対に含めない**。SAFE_ENV は `PATH`（可能なら base ツールチェーンに限定）・`LANG` 等の
無害変数に限る。

## 7. 段階導入案

ADR-003 の Non-Goals「既定を advisory から enforced へ勝手に変えない」を厳守し、**既定は無効**を
維持する。

- **Phase 0（現状）**: command 実行機構なし。strict_block は既存 finding 入力のみ。
- **Phase 1（本設計の最小実装, opt-in・既定 OFF）**: `RIVER_DETERMINISTIC_EXEC=1` 等の明示
  opt-in でのみ command 実行を有効化。有効時も機構 1-6 を全て通す。allowlist が無い / base pin
  未設定なら実行せず `DETERMINISTIC_UNRUNNABLE`。CI では `gate: false`（advisory）と組み合わせ、
  digest で実行実績・unrunnable 率を観測する。
  **Phase 1 の必須前提条件（敵対レビュー・3 ブロッカー、これらを満たすまで実装しない）**:
  1. allowlist は「自己完結 command」限定（絶対パス・config autoload 無効・PR head の
     scripts/config/`node_modules` を読まない）。素の `npm`/`npx`/`bash`/`node`/`sh` は schema/実装で拒否。
  2. `persist-credentials: false` + `.git` 非露出の clean cwd + `HOME` を空一時ディレクトリへ差し替え
     （on-disk token / `~/.aws` 遮断）。SAFE_ENV に `NODE_OPTIONS` 等を含めない。
  3. command は symlink 非追跡、stdout を PR/findings に生出力せず判定は exit code のみ
     （symlink→stdout exfil の遮断）。
     「dark-launch（advisory・digest 観測）でも same-repo ブランチからの secret 窃取は成立する」ため、
     観測フェーズでも上記 3 点は先に満たす。
- **Phase 2**: 観測で誤爆・NO_GO ストームが無いことを確認したチームが、`gate: true` +
  deterministic exec を有効化。
- **Phase 3（将来）**: 署名済み ref のみ実行（機構 1 の却下代替案の格上げ）、PATH ハードニング、
  スクリプト間接実行の禁止（残攻撃面 2・3 への対処）。

各 Phase は River Review の既存 2 段階導入（advisory → enforced）と整合させる。

## 8. 完了条件（DoD）と検証方法

本設計を実装する PR は次を満たすこと。

### 8.1 機能 DoD

- [ ] schema（ajv + zod）に `args` を追加し、parity canary（#1399）green。
- [ ] deterministic 実行器が `RIVER_TRUSTED_TREE`（base）から command/args/allowlist を解決する。
- [ ] allowlist 不一致 command を実行せず `DETERMINISTIC_UNRUNNABLE` を出す。
- [ ] 子プロセス env が allowlist のみ（`GITHUB_TOKEN` 等が継承されないことをテストで実証）。
- [ ] `execFile`（shell 非経由）で実行、`args` 未指定の空白入り旧 command は実行しない。
- [ ] spawn 失敗 / timeout → `ESCALATE`（`DETERMINISTIC_UNRUNNABLE`）、非ゼロ exit → `NO_GO`
      （`STRICT_BLOCK`）に分岐。
- [ ] timeout / stdout 上限 / プロセスグループ kill が効く。
- [ ] `deriveGateDecision` に unrunnable 入力を追加し、rule 順・inputsHash を確定。opt-in 既定 OFF。

### 8.2 テスト観点（canary / 敵対テストを含む）

- **env スクラブ**: `GITHUB_TOKEN=secret` を親に設定した状態で command を起動し、子が
  それを読めない（空 / 未定義）ことを assert。allowlist した `PATH` のみ渡ることを確認。
- **trusted-ref pin canary**: PR head の `deterministicGate.command` を `evil` に書き換えた
  fixture で、実行されるのは base 側の command であることを assert。base に無い skill id の
  command が実行されないことも。
- **allowlist 照合**: allowlist 完全一致のみ実行、args 1 要素違い / 部分一致 / glob 風文字列は
  実行しないことを網羅（false-positive canary としても機能）。
- **argv 契約**: `command: "npm run lint"`（args 無し・空白入り）が実行されず unrunnable に
  なること。`{ command: "npm", args: ["run", "lint:ci"] }` は正しく起動すること。
- **spawn error / timeout 分離**: ENOENT command → ESCALATE、`sleep 999`（timeout）→ kill →
  ESCALATE、`exit 1` → NO_GO を各々 assert。**NO_GO ストーム回帰テスト**: 複数 skill が
  一斉に実行不能でも全体が NO_GO でなく ESCALATE に倒れること。
- **DoS**: 巨大 stdout（>1 MiB）で打ち切り、子孫プロセスが timeout kill 後に残らないこと。
- **rule 0 連動**: `.river/deterministic-allowlist.yaml` を触る diff が `GATE_CONFIG_CHANGED`
  で ESCALATE することを既存 rule 0 テストに追加。
- **fixture / description drift**: `deterministicGate` を含む skill fixture と schema
  `description`、parity canary を同一 PR で更新（CLAUDE.md 対応ガード）。

### 8.3 ドキュメント DoD

- [ ] ADR-003 の follow-up 参照（#1401）を本設計の結論で更新、または新 ADR/pages に反映。
- [ ] 残攻撃面（§6）を利用者向けドキュメントに明示（特に「allowlist 内 command の中身は
      PR 制御」「fork 爆弾は CI 資源制限依存」「base の人間レビュー必須が前提」）。

## 9. 参照

- Issue: #1401（本設計の対象）、Epic #1347 S4 = #1351（descope の経緯）
- `schemas/skill.schema.json`（`deterministicGate` 現定義・TRUST BOUNDARY 警告）
- `src/lib/skillYamlSchema.mjs`（zod 側 `deterministicGate`, `.strict()`, #1399 parity）
- `src/lib/gate-decision.mjs`（`deriveGateDecision`, rule 0-12, `STRICT_BLOCK`, fail-safe 方向）
- `src/lib/deterministic-gate.mjs`（`computeStrictBlock`, `isStrictBlockSkill`, opt-in 原則）
- `src/lib/git.mjs`（既存 `execFile` 利用パターン・`maxBuffer` の先例）
- `runners/github-action/action.yml`（CI 実行構成・env・`--gate` 2 段階導入）
- `docs/adr/003-risk-tiered-human-supervision.md`（trust boundary・#1401 への委譲）
- `docs/development/pipeline-params-checklist.md`（`deriveGateDecision` 引数伝播）
  </content>
  </invoke>
