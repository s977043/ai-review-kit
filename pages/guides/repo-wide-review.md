# リポジトリ全体を踏まえたレビュー（repo-wide review）の導入とチューニング

このガイドは、River Review を「PR 差分だけを見るレビュー」から「変更ファイル周辺のリポジトリ文脈を踏まえたレビュー」に発展させるための手順をまとめたものです。日本語が source of truth です（英語版は別 PR で追従）。

関連:

- 親 Epic: [#650 Greptile-inspired repo-wide review capabilities](https://github.com/s977043/river-review/issues/650)
- 既存ガイド: [クイックスタート](./quickstart.md) / [GitHub Actions セットアップ](./github-actions.md) / [トラブルシューティング](./troubleshooting.md)
- 参考: [スキル作成ガイド](./write-a-skill.md) / [レビューポリシー](../reference/review-policy.md)

## このガイドが想定する読者

- River Review を導入済みで、PR 差分のみのレビューから一歩進めたいチーム
- 変更ファイル単独では検出しづらい不整合（locale 未削除、normalization 不揃い、API 互換性、テスト欠落など）を拾いたい人
- 既存設定（`.river-review.yaml`、`.river/rules.md`）の運用方針を整理したい運用担当者

## repo-wide review が解決する問題

PR 差分だけを見るレビューには次のような限界があります。

- 削除した翻訳キーに対応する `en.json` のエントリが残ることに気づけない
- 同じドメイン概念に対する命名・正規化が周辺コードと揃っているか確認できない
- API の互換性破壊に対応するテスト追加が漏れていないか確認できない
- 共通パターン（loading state、null 契約、observability など）と一貫しているか確認できない

repo-wide review は、変更ファイルから派生する「関連ファイル」「テスト」「symbol の利用箇所」「設定ファイル」を自動で集め、レビュー LLM のコンテキストとして併送します。これにより上記のような cross-file な不整合を拾える確率が上がります。

## 最小導入手順

1. リポジトリ直下に `.river-review.yaml` を配置（後述の例を参照）。
2. `.river/rules.md` を作成（`.river/rules.template.md` を `cp` で複製）。
3. 必要なら `.river/risk-map.yaml` を追加（既定では `comment_only` のため省略可）。
4. GitHub Actions ワークフローを `.github/workflows/river-review.yml` に追加。
5. `OPENAI_API_KEY` などのモデル鍵をリポジトリ Secrets に登録。
6. PR を作成し、コメントとして指摘が投稿されるか確認。

### 最小 GitHub Actions ワークフロー

```yaml
name: River Review (repo-wide)
on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
jobs:
  river-review:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      issues: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0 # repo-wide context collector が周辺コミット履歴を読むため必須
      - name: Run River Review (midstream)
        uses: s977043/river-review/runners/github-action@v1.22.0
        with:
          phase: midstream
          dry_run: false
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

> 例では `@v1.22.0` に固定しています。最新リリースが出た場合はそのタグへ置き換えてください。
>
> `fetch-depth: 0` は repo-wide context collector が変更ファイル周辺のコミット履歴・関連ファイルを参照するために必要です。shallow clone のままだと collector が劣化します。

## 設定ファイル

### `.river-review.yaml`

`src/config/schema.mjs` の `riverReviewerConfigSchema` に対応する legacy 設定です。実例:

```yaml
model:
  provider: openai
  modelName: gpt-4o-mini
  temperature: 0.2
  maxTokens: 600
review:
  language: ja
  severity: normal
  additionalInstructions:
    - 'PR 差分だけでなく、変更ファイル周辺のテスト・locale・型定義との整合性を確認すること。'
    - 'Severity は critical / major / minor / info の 4 段階。Major 以上は具体的な根拠を必須とする。'
exclude:
  files:
    - 'package-lock.json'
    - 'pnpm-lock.yaml'
    - '**/*.snap'
  prLabelsToIgnore:
    - 'skip-review'
    - 'release'
```

> 設定値は zod でバリデーションされます。未知のキーは警告のみで実行は継続します（`src/config/loader.mjs` 参照）。

### `.river/rules.md`

リポジトリ固有のレビュー方針を Markdown で書き、LLM プロンプトへ自動注入します。`.river/rules.template.md` を複製して必要セクションだけ書き換えるのが推奨運用です。

```markdown
# Project-specific Review Rules

## Architecture / アーキテクチャ方針

- Next.js App Router、サーバーコンポーネントを優先する
- 共有ロジックは `src/lib/` 配下、UI は `src/components/` 配下に置く

## Forbidden Patterns / 禁止パターン

- `any` の使用（unknown + narrowing で代替）
- 同期的な fs 呼び出し（`fs.promises` を使う）
- React コンポーネント内での直接 `localStorage` アクセス

## Recommended Libraries / 推奨ライブラリ

- HTTP クライアント: `fetch` または `ky`
- 状態管理: Zustand
- 日付: `date-fns`（`moment` は禁止）

## Testing Requirements / テスト要件

- 新規 UseCase はユニットテスト必須（`tests/use-cases/` 配下）
- API 境界変更は統合テスト追加
```

> リポジトリの秘密情報（トークン、固有 ID）は書かないこと。例示する場合はダミー値を使います。

### `.river/risk-map.yaml`

ファイルパス glob ごとに「どの程度厳しくレビューするか」を宣言します。先頭から順にマッチし、最初にヒットしたルールが採用されます（first-match-wins）。`schemas/risk-map.schema.json` 参照。

```yaml
version: '1'
rules:
  - pattern: 'src/lib/security/**'
    action: require_human_review
    reason: 'セキュリティ系ロジックは LLM 単独で承認しない'
  - pattern: 'src/lib/payments/**'
    action: escalate
    reason: '決済まわりは Critical/Major を必ず major 以上に格上げ'
  - pattern: 'pages/**/*.md'
    action: comment_only
    reason: 'ドキュメントは指摘を出すが gating はしない'
defaults:
  action: comment_only
```

`action` の意味（`schemas/risk-map.schema.json` の enum）:

| action                 | 挙動                                                          |
| ---------------------- | ------------------------------------------------------------- |
| `comment_only`         | 通常通り指摘を投稿。マージのブロックはしない                  |
| `escalate`             | 指摘の severity を引き上げ、PR コメント先頭に注意喚起を強める |
| `require_human_review` | LLM レビューに加え、人間レビュアー必須の警告を PR に明示する  |

## repo-wide context collector の挙動

変更ファイルから次の 4 セクションを集めます（実装: `src/lib/repo-context.mjs`）。

| セクション | 取得元                                      | 既定の上限   |
| ---------- | ------------------------------------------- | ------------ |
| `fullFile` | 変更ファイル本体（最大 5 ファイル）         | 約 3000 文字 |
| `tests`    | path heuristic で見つけた対応テスト         | 約 2000 文字 |
| `usages`   | `rg` で grep した export symbol の使用箇所  | 約 1500 文字 |
| `config`   | sibling な設定ファイル（`.json` / `.yaml`） | 約 500 文字  |

合計上限は既定 8000 文字です（`.river-review.yaml` の `context.budget` キー、または `collectRepoContext` の `maxChars` 引数で上書きできます）。各セクションは末尾から `// ...[truncated]` で切り詰めます。

`rg`（ripgrep）が利用できない環境では `usages` セクションが best-effort で空になります。CI ランナー側にあらかじめ ripgrep を入れておいてください（GitHub Actions の標準 Ubuntu イメージには同梱）。

### context budget / ranking の調整方針

`#689` で導入された設定キーで、token 単位の budget・`reviewMode` プリセット・ranking スコアを `.river-review.yaml` から調整できます。スキーマ詳細は `src/config/schema.mjs` を参照してください。

```yaml
# .river-review.yaml
context:
  reviewMode: medium # tiny | medium | large。budget を省略するとプリセットを適用
  budget:
    maxTokens: 4000 # 256〜64000。明示指定があれば reviewMode より優先
    maxChars: 8000 # 1024〜200000。char 上限と token 上限の両方が効きます
    perSectionCaps:
      fullFile: 3000
      tests: 2000
      usages: 1500
      config: 500
  ranking:
    enabled: true # 変更ファイルとの近接度スコアで候補を並べ替え
    weights: # 0.0〜1.0。省略時は等重み
      pathProximity: 0.4
      symbolUsage: 0.3
      siblingTest: 0.2
      commitRecency: 0.1
```

`reviewMode` プリセット（`src/lib/context-presets.mjs`）の `maxTokens` 既定値:

| reviewMode | maxTokens | 想定用途                                              |
| ---------- | --------- | ----------------------------------------------------- |
| `tiny`     | 1024      | 短いプロンプト、CI 回帰、コンテキスト窓の小さいモデル |
| `medium`   | 4000      | gpt-4o-mini / sonnet 級モデルでの通常 PR              |
| `large`    | 16000     | 大型モデルでの深掘りレビュー                          |

ranking のスコアリングは `src/lib/context-ranker.mjs` の `pathProximity` / `symbolUsage` / `siblingTest` / `commitRecency` で構成され、変更ファイルから「近い」順に候補を絞ります。スコア内訳は `reviewDebug.repoContextRanking` で確認できます。

その他、ノイズが多いと感じたら `.river-review.yaml` の `exclude.files` を強化したり、`risk-map.yaml` の `action: comment_only` を docs に当てて gating だけ外すといった既存運用も引き続き有効です。

## secret redaction と safe defaults

repo-wide context collector が読み取るファイルとプロンプトに注入される文字列は、LLM へ送信する前に **多段階で redact** されます（[Issue #692](https://github.com/s977043/river-review/issues/692)）。

実装の中心は `src/lib/secret-redactor.mjs`、結線は `src/lib/repo-context.mjs` / `src/lib/local-runner.mjs` / `src/lib/review-engine.mjs` の三箇所です。

### Path-level deny（読まずに弾く）

`.env*`、`*.pem` / `*.key` / `*.p12` 等の鍵類、`secrets.*` / `credentials.*`、各種 lock / build artifacts は **そもそも process memory に読み込まれません**。`shouldExcludeForContext` が `DEFAULT_DENY_GLOBS` で先頭フィルタします。

### Content redaction（読んだ後に伏字化）

deny リストを通過したファイルは `redactText` を経由してプロンプトに入ります。

検出カテゴリ:

- `githubToken` / `openaiKey` / `anthropicKey` / `googleApiKey`
- `awsAccessKey` / `awsSecretKey`
- `privateKey`（`-----BEGIN ... PRIVATE KEY-----` の複数行ブロック）
- `bearerToken` / `databaseUrl` / `webhookUrl`（Slack/Discord） / `oauthSecret`
- `envAssignment`（`API_KEY=...` 等の代入）
- `highEntropy`（Shannon entropy 閾値超え 24 文字以上のフォールバック）

置換は **長さ非依存**な `<REDACTED:category>` 形式なので、suppression fingerprint（#687）の安定性に影響しません。

### config で挙動を絞る

```yaml
# .river-review.yaml
security:
  redact:
    enabled: true # default
    categories:
      highEntropy: false # 偽陽性が多い場合は entropy fallback を切る
    allowlist:
      - 'TESTFIXTURE' # 一致するトークンは redact しない（テスト固定値の保護）
    denyFiles:
      - 'vendor/**' # 既定の deny に上乗せして除外
    entropyThreshold: 4.7 # default 4.5。値を上げるほど検出が緩くなる
```

### 多段防御

debug 出力 / artifact / dashboard へ流れる `prompt` と `debug.promptPreview` も最終段で再度 `redactText` を通します。万一 `additionalInstructions` などからトークンが混入しても、ログ・成果物には伏字化された文字列のみ残ります。LLM の API 呼び出しで使うプロンプトは redaction 適用後（PR-C のリポジトリ context redaction）のものなので、LLM 側にも生のトークンが渡ることはありません。

### 観測

`reviewDebug.repoContextSecurity = { redactionHits, excludedPaths }` に集計値（カテゴリ別の置換回数 / 除外したパス）が乗ります。生のトークンは含まれません。

## cross-context skills の追加方法

cross-context skills は、変更ファイル単独では検出しづらいパターンを集めたスキル群です。`skills/midstream/rr-midstream-*-001/` 配下に既に以下が同梱されています（[Issue #654](https://github.com/s977043/river-review/issues/654) で完了）。

- `rr-midstream-i18n-unused-key-001` — 翻訳キーの削除と locale エントリの整合
- `rr-midstream-normalization-consistency-001` — ドメイン正規化（ID 形式、小文字化など）の不揃い
- `rr-midstream-loading-state-001` — early return / loading state の遷移漏れ
- `rr-midstream-nullability-contract-001` — null/undefined 契約の崩れ
- `rr-midstream-api-compatibility-001` — API 互換性破壊と対応テスト欠落

新しい cross-context skill を追加する手順は [スキル作成ガイド](./write-a-skill.md) を参照してください。要点だけ抜粋すると:

1. `skills/midstream/rr-midstream-<your-skill>-001/SKILL.md` を作る（YAML frontmatter + 本文）。
2. `inputContext` に `diff` だけでなく `fullFile` を含める（含めると collector の出力が LLM へ渡る）
3. fixture を `fixtures/01-should-detect.md` / `02-should-not-detect.md` に置く
4. `npm run skills:validate` で schema を検証する

## P1 / P2 / P3 / P4 priority の読み方

LLM が出力する severity（`critical` / `major` / `minor` / `info`）は、PR コメント上では P1〜P4 にマッピングして表示されます（実装: `src/lib/finding-format.mjs:severityToPriority`）。

| 表示 | severity   | 例                                                           |
| ---- | ---------- | ------------------------------------------------------------ |
| P1   | `critical` | セキュリティ脆弱性、データ損失リスク、システムダウンの可能性 |
| P2   | `major`    | 重大なバグ、パフォーマンス問題、設計上の大きな問題           |
| P3   | `minor`    | 小さなバグ、可読性の問題、軽微な最適化の機会                 |
| P4   | `info`     | 提案、参考情報、追加の検討事項                               |

PR コメントの先頭サマリには P1 / P2 件数が強調表示されます。`risk-map.yaml` で `require_human_review` がヒットしたパスは「人間レビュー必須」として PR に明示されます（[Issue #652](https://github.com/s977043/river-review/issues/652)）。

## false positive suppression memory

「これは false positive だった」「accepted_risk として了承済み」というフィードバックを蓄積し、同じ fingerprint の指摘が再発しないよう抑制する仕組みです（[Issue #687](https://github.com/s977043/river-review/issues/687)）。

### 仕組み

- 各 finding は `computeFingerprint(ruleId + file + 正規化メッセージ)` で 16-hex の安定 fingerprint を持つ（実装: `src/lib/finding-fingerprint.mjs`）
- Riverbed Memory に `type: 'suppression'` エントリとして fingerprint と feedbackType を書き込むと、次回以降同 fingerprint の指摘は自動的に `findings` から除外される
- 対応する PR コメントも投稿されない（実装: `src/lib/suppression-apply.mjs`、`src/lib/local-runner.mjs`）
- **P1 ガード**: severity が `major` / `critical` の指摘は `feedbackType=accepted_risk` のみ自動抑制を許可
- それ以外の feedbackType では抑制されず、観測ログに `reason: high-severity-requires-accepted-risk` が残る

### CLI で suppression を追加する

```bash
# --scope は既定 "file"、--pr は任意（出所 PR）
river suppression add \
  --fingerprint <16-hex> \
  --feedback <false_positive|accepted_risk|wont_fix|not_relevant|duplicate> \
  --rationale "<なぜ抑制するか>" \
  --scope <global|subsystem|file> \
  --severity <info|minor|major|critical> \
  --files src/auth.ts,src/login.ts \
  --pr 123
```

fingerprint は `--debug` 出力または `reviewDebug.suppressionsApplied` から拾います。`<16-hex>` 厳密チェック・feedbackType enum チェックが事前に走るため、誤入力は exit 1 で弾かれます。

### config で抑制を一時無効化する

```yaml
# .river-review.yaml
memory:
  suppressionEnabled: false # 既定 true。false で全 suppression をバイパス（緊急デバッグ用）
```

抑制をバイパスしても Riverbed Memory のエントリは保持されます。`true` に戻せば即座に再有効化されます。

### feedbackType の使い分け

| feedbackType     | 用途                                               | major/critical の自動抑制 |
| ---------------- | -------------------------------------------------- | ------------------------- |
| `false_positive` | 検出パターンが誤検知                               | ❌                        |
| `accepted_risk`  | 既知のリスクを意識的に許容                         | ✅                        |
| `wont_fix`       | 修正コストが高すぎる、優先度低                     | ❌                        |
| `not_relevant`   | このコードベースには無関係なルール                 | ❌                        |
| `duplicate`      | 既存 suppression と同義（`--duplicate-of` の代替） | ❌                        |

## eval fixtures の実行方法

「context あり/なしで検出差を計測する」regression fixtures が [Issue #688](https://github.com/s977043/river-review/issues/688) として用意されています（v0.28.0 で全機能着地）。

```bash
npm run eval:repo-context        # repo-wide eval 単体実行
npm run eval:all                 # 統合 driver（planner / fixtures / regression / meta / repo-context）
```

### Fixture 構造

`tests/fixtures/repo-wide-eval/` に以下の 8 ケースが同梱されています:

| Case                            | Category      | 目的                                                  |
| ------------------------------- | ------------- | ----------------------------------------------------- |
| `i18n-unused-key-01`            | i18n          | 削除した翻訳キーが locale に残るパターン              |
| `normalization-id-format-01`    | normalization | 既存の正規化ヘルパーをバイパスする呼び出し            |
| `loading-state-early-return-01` | loading       | loading guard 削除による null deref                   |
| `nullability-api-response-01`   | nullability   | nullable 契約の不安全な dereference                   |
| `api-contract-no-test-01`       | api-compat    | 必須フィールド追加に伴うテスト未更新                  |
| `guard-future-use-comment`      | guard         | TODO を rationale に置き換え（指摘は false positive） |
| `guard-generated-file`          | guard         | 生成ファイルのヘッダー更新                            |
| `guard-related-test-updated`    | guard         | source 変更と同 PR でテストを更新済み                 |

新しい fixture を追加する手順は `tests/fixtures/repo-wide-eval/README.md` を参照。

### 出力されるメトリクス

`evaluateRepoWideFixtures` の summary は以下を返します:

| Metric                                             | 意味                                                                                        |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `detectionRateWith / detectionRateWithout`         | 検出ケースのうち finding が出た割合（context あり / なし）                                  |
| `contextLiftRate`                                  | `withCtx − withoutCtx` の平均（正なら repo-wide context が検出力を上げている）              |
| `falsePositiveRateWith / falsePositiveRateWithout` | guard ケースのうち false positive を出した割合（理想は 0）                                  |
| `categoriesCovered`                                | 検出されたカテゴリ一覧（i18n / normalization / loading / nullability / api-compat / guard） |

### Nightly drift detection

`.github/workflows/nightly-eval.yml` が `evaluate-all.mjs` を呼ぶため、repo-context メトリクスは自動で `artifacts/evals/results.jsonl` の ledger に追記されます。日々の値の変化が drift detection になります。

## troubleshooting

### context が空で投入されている

- `actions/checkout` の `fetch-depth: 0` が設定されているか確認する（shallow clone だと collector が動作しないことがある）
- ripgrep が runner にあるか（`which rg`）を確認する（GitHub Actions の標準 Ubuntu イメージには同梱）
- `dry_run: true` のままになっていないかを確認する（dry run は LLM を呼ばず heuristic 出力のみ返すため、context が薄い指摘になりがち）

### コメントが投稿されない

- workflow の `permissions` に `pull-requests: write` と `issues: write` があるか。
- フォークからの PR は secrets が伝播しないので、外部コントリビューターの PR でレビューを動かすには `pull_request_target` 等を選び、安全側で実装する必要があります（[github-actions ガイド](./github-actions.md)）。

### 指摘が多すぎる / 少なすぎる

- `.river-review.yaml` の `review.severity` を `strict` / `relaxed` で切替。
- ノイズが多いパス（自動生成物、ベンダー）を `exclude.files` に追加。
- 逆に「ここだけは厳しく見たい」パスは `risk-map.yaml` の `action: escalate` で持ち上げる。

### 同じ指摘が毎回出る

- `river suppression add --fingerprint <hex> --feedback <type> --rationale "..."` で個別に抑制する（[suppression memory セクション](#false-positive-suppression-memory)）
- `.river/rules.md` の `## Forbidden Patterns` に「これは許容済み」と明記して LLM 側で抑止する（軽量な代替手段）

### 設定ファイルが反映されない

- `river run . --dry-run --debug` で読込ログを確認する（`.river/rules.md` の認識確認に使える）
- `.river-review.yaml` の YAML 構文エラーは loader が警告を出す（zod バリデーション失敗時はメッセージを参照して直す）

## さらに読む

- [レビューポリシー](../reference/review-policy.md) — Severity の定義と運用基準
- [Riverbed Memory](./use-riverbed-memory.md) — wontfix / suppression エントリの書込先
- [スキル作成ガイド](./write-a-skill.md) — cross-context skill の追加手順
- [Tracing / Observability](./tracing.md) — 実行時のメトリクスとデバッグ出力
