# Execution Manifest（1 回の Review Run の実行証跡）

Review Run ごとに「何を使って判断したか」を再現可能な形で固定する契約です（#2015 / Epic #2011 Phase 4）。

- 契約スキーマ: `schemas/execution-manifest.schema.json`
- 実装: `src/lib/execution-manifest.mjs`
- 検証: `tests/execution-manifest.test.mjs`
- 決定的 fixture: `tests/fixtures/execution-manifest/complete.json` / `partial.json`

Skill は「何を判断するか」、Agent は「誰が責任を持つか」、Flow は「いつ・どう判断を実行するか」を担います。Execution Manifest はそれらの**実行時の版と hash** を 1 通の文書へ固定し、後から改竄を検出できるようにします。

## Experiment Manifest との違い

`buildExperimentManifest`（`src/lib/paired-replay.mjs`）を拡張せず、別文書として新設しました。理由は主語が違うためです。

| 観点         | Experiment Manifest（契約3）                        | Execution Manifest（#2015）             |
| ------------ | --------------------------------------------------- | --------------------------------------- |
| 主語         | baseline / candidate 2 構成の実験                   | 単一の Review Run                       |
| 必須ブロック | `baseline` / `candidate` / `dataset` / `acceptance` | `flow` / `agents` / `skills` / `policy` |
| 入力         | 既に生成済みの run record 群                        | 1 回の実行構成                          |
| id namespace | `RR-EXP-`                                           | `RR-EXM-`                               |

両者の必須ブロックは重ならないため、1 文書へ統合すると `kind` による条件付き required が十数フィールドに増えます。`additionalProperties: false` な文書を 2 通に分けるほうが契約として強くなります。

一方で**導出（derivation）は共有**します。`sha256Hex`・`canonicalJson`・`nonEmptyNfcString`・`deriveReviewRunId` は既存モジュールから import しており、本モジュールは 1 つも再実装していません。`sha256Hex` は本 PR で `src/lib/shadow-aggregate.mjs` から export し、`paired-replay.mjs` の private コピーも同じ関数へ寄せました。

## ブロックと解決ステータス

manifest は 9 ブロックを持ち、各ブロックが `status` を持ちます。

| status        | 意味                                                              |
| ------------- | ----------------------------------------------------------------- |
| `resolved`    | そのブロックが必要とする値がすべて揃っている                      |
| `missing`     | 情報源は存在するが、この run が記録していない                     |
| `unavailable` | 呼び出し側が「固定すべき対象が無い」と明示した（空の skill 選択） |

`null` を単独で置かない理由は、「記録し損ねた」と「そもそも無かった」が区別できなくなるためです。この区別を失うと、replay 不能な run を replay 可能と誤認する経路がそのまま開きます（AC 3）。

## Replay の 2 クラス

| クラス          | 必要ブロック                                          | 判定                                                     |
| --------------- | ----------------------------------------------------- | -------------------------------------------------------- |
| `deterministic` | `flow` / `skills` / `artifacts` / `policy` / `config` | routing・refs・coverage・hash・gate 導出は同一結果を要求 |
| `judgment`      | 上記 + `agents` / `runtime`                           | 意味的同等性で測る。byte-for-byte 一致は要求しない       |

`assessReplayability(manifest)` が両クラスの可否と欠損ブロックを返します。manifest が無い場合は空の結果ではなく、明示的な理由付きで `not replayable` を返します。

skill は id だけでは `resolved` になりません。checksum が無ければ run と replay の間で SKILL.md 本文が変わったことを検出できないためです。

## 情報源の実測（本リポジトリ現況）

| ブロック      | 情報源                                                            | 現況      |
| ------------- | ----------------------------------------------------------------- | --------- |
| `riverReview` | `package.json` の `version`                                       | 解決可能  |
| `plugin`      | `.claude-plugin/plugin.json` の `version`                         | 解決可能  |
| `skills`      | `docs/data/skill-manifest.json` の `skills[].checksum`            | 解決可能  |
| `runtime`     | Review Artifact の `usage.provider` / `usage.model`               | 解決可能  |
| `policy`      | Review Artifact の `gate.inputs.riskMapDigest`                    | 部分的    |
| `agents`      | `agents/contracts/*.agent.json`（id と version。checksum は無い） | 部分的    |
| `flow`        | flow の実体文書が未作成（`flows/` も `*.flow.json` も無い）       | `missing` |
| `artifacts`   | 記録する producer が未実装                                        | `missing` |
| `config`      | 記録する producer が未実装                                        | `missing` |

resolver は情報源が無いブロックを捏造せず `missing` のまま返します。

## secret / raw context を複製しない仕組み（AC 2）

2 段構えで担保します。

1. **構造的拒否**: `assertNoRawContext` が `prompt` / `rawLlmOutput` / `toolOutput` / `patch` / `reasoning` などのキーを spec 全体で拒否する。redaction はパターン検出であり、貼り付けられた diff や prompt は検出できないため、そもそも該当フィールドを持たせない
2. **値の redaction**: 残る文字列 leaf すべてに `redactText`（`src/lib/secret-redactor.mjs`）を適用し、category ごとの hit 数を `redaction.hits` に記録する

redaction は hash 計算の**前**に走ります。後から redact すると、保存済み manifest と再計算 hash が食い違い、全 manifest が `verifyExecutionManifest` に落ちます。

`spec.artifacts` のキーだけは拒否対象から外しています。artifact 名としての `diff` は #2015 の manifest 候補が明示的に挙げている正当な名前であり、値は `sha256` へ正規化されるためです。

なお `src/lib/result-store.mjs` の run record 書き出しは「上流で redact 済み」という前提に依存しています（`result.reviewDebug` のコメント参照）。本 manifest はその前提の外に出ないよう、自前で redaction を持ちます。

## 後方互換と既存 run record の移行方針（AC 4 / AC 6）

Review Artifact への連結は additive・optional です。`attachExecutionManifest` は manifest が `null` のとき artifact を素通しし、キー集合を変えません。

配置は `debug` 配下ではなく**トップレベル** `executionManifest` を選びました。`debug` は「構造は版をまたいで保証されない」と自ら宣言しており、「この run は replay 可能か」を answer するブロックの置き場所としては契約が弱すぎます。トップレベルは `additionalProperties: false` のため `schemas/review-artifact.schema.json` の変更が必要です。ただしこれは同スキーマが過去に繰り返してきた optional 追加と同じ形であり、`pages/reference/stable-interfaces.md` の「optional 追加は同一ファイル内」に沿います。

既存 run record の移行方針は次のとおりです。

- **遡及生成しない**: manifest 未添付の過去 run へ後から manifest を書き足さない。実行時にしか観測できない値を後付けすると、`resolved` に見えて実際は推測という最悪の状態になる
- **欠損は欠損のまま扱う**: manifest を持たない run は `assessReplayability` が `not replayable` と答える。これが正しい答えであり、埋めるべき穴ではない
- **段階的に埋める**: producer 側が `flow` / `artifacts` / `config` を記録できるようになった時点から、新しい run だけが `resolved` になる。過去 run との比較は `manifestKey` の有無で分岐する

## 未実装（本 PR のスコープ外）

本 PR は「Manifest 契約と resolver まで」（#2015 のスコープ）を範囲としています。次は含みません。

- replay の実行エンジン（deterministic replay の再実行、judgment replay の意味的比較）
- review パイプラインへの配線（`finalizeArtifact` からの自動生成）
- judgment replay dataset との連結
