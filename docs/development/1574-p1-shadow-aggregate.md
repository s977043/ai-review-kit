# Review Evolution Cycle P1 Shadow aggregate（#1574）

> Status: P1 実装。P0 設計契約（`docs/development/1574-p0-design-contract.md`）を DoD として参照します。
> Source: issue #1574 採否コメント（comment ID 5064856987）の推奨実装順 P1。

## 1. 目的とスコープ

P1 は、完了済みの review run と feedback を **読み取り専用**で集約し、shadow candidate を 1 件生成するフェーズです。数サイクル分の出力を人間が確認し、candidate の品質を測ることが目的になります。

含むもの:

- trusted / untrusted を区別した run evidence の集約
- canonical `review_run_id` による run と feedback の突合
- 二段階クラスタリング（反復検知 → 原因仮説）
- content-addressed な shadow candidate の生成（1 件）

含まないもの:

- Skill / Rule / Riverbed / gate / PR への書き込み
- canary、rollback、自動昇格（P3・P4 の範囲）
- retire / effectiveness lifecycle（#1568-C へ委譲する）

## 2. データフロー

```text
.river/runs/*.json ─┐
                    ├─▶ buildShadowAggregate()（純関数・副作用なし）
.river/feedback/*.jsonl ─┘
                            │
                            ├─▶ evidence[]      : 契約1 provenance + trust_level
                            ├─▶ join            : 契約2 の突合カバレッジ
                            ├─▶ clusters[]      : 契約5 の stage1 / stage2
                            └─▶ candidate       : 契約4 の content-addressed ID（最大1件）
                                    │
                                    └─▶ stdout（JSON / Markdown）
```

集約入力の読み出しには既存の `loadAllRunRecords`（`src/lib/result-store.mjs`）と `listFeedbackEntries`（`src/lib/feedback.mjs`）をそのまま使い、新しい保存形式は追加しません。出力は標準出力のみで、ファイルへ書き出す option は意図的に持たせていません。

## 3. ファイル配置

| ファイル                               | 役割                                                          |
| -------------------------------------- | ------------------------------------------------------------- |
| `src/lib/shadow-aggregate.mjs`         | 集約ロジック本体。I/O を持たない純関数群                      |
| `src/lib/promotion-candidates.mjs`     | candidate ID 導出の SSoT（#1624）。本機能は再実装せず利用する |
| `src/cli/commands/evolve.mjs`          | `river evolve aggregate` のハンドラ。読み出しと出力のみ       |
| `schemas/shadow-aggregate.schema.json` | 出力アーティファクトと candidate の JSON Schema               |
| `tests/shadow-aggregate.test.mjs`      | 契約準拠・決定性・read-only のテスト                          |

## 4. CLI

```bash
river evolve aggregate <path> [--min <n>] [--month YYYY-MM] [--output json]
```

- `--min`: stage1 の反復しきい値である（既定 2、#1568-A と同値）
- `--month`: run と feedback の両方を `YYYY-MM` に限定する（片側だけ絞ると集計期間がずれるため）
- `--output json`: 機械可読な集約 JSON を出力する（既定は Markdown）。`yaml` / `html` は未対応で reject する

正常終了時の exit code は 0 です。P1 の出力は gate ではなく観測であるため、しきい値超過では失敗させません。ただし使い方の誤り（不明なサブコマンド・余剰引数・不明オプション・未対応の `--output`）は exit 1 で明示的に失敗します。`river evolve agregate` のような typo を path として黙って受け取り、空の成功結果を返すことはありません。

## 5. 設計契約との対応

| 契約                            | P1 での実装                                                                              | 実装箇所                                     |
| ------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------- |
| 契約1 evidence provenance       | run ごとに provenance を記録しつつ、trust level は常に `untrusted` に固定する            | `buildRunEvidence` / `evidenceTrustLevel`    |
| 契約2 canonical `review_run_id` | optional field を read 側で解決し、突合できた feedback 件数を報告する                    | `deriveReviewRunId` / `join`                 |
| 契約3 Experiment Manifest       | P2 の範囲。P1 では実装しない                                                             | —                                            |
| 契約4 stable CLI / content ID   | `river evolve aggregate` を stable CLI とし、ID 導出は #1624 の実装へ一本化する          | `computeCandidateId`（#1624 の薄い adapter） |
| 契約5 two-stage clustering      | stage1 は `(skillId, feedbackType)`、stage2 は fingerprint / category / scope で分割する | `buildClusters`                              |
| 契約6 profile 別受入基準        | P2 の範囲。P1 では実装しない                                                             | —                                            |

補足:

- `evidence_source` が未記録の run は `local` として扱う
- fingerprint を持たない sub-cluster は表示だけ許可し、`experimentEligible: false` を立てる
- 同じ fingerprint の feedback が複数行あっても 1 件の finding とみなす。`experimentEligible` は distinct な (run, PR) の件数で判定する
- stage2 の `failureMode` は `null` 固定である。語彙は P1 の観測後に確定する契約のため、先取りしない
- candidate の `trust.canaryEligible` は P1 では常に `false` である

### candidate ID の一本化（契約4）

candidate ID は `src/lib/promotion-candidates.mjs` の `normalizeEvidence` と `computeCandidateContentHash` をそのまま使います。shadow 側で別の hash を持つと、同じ証拠から生まれた観測と `river promote propose` の永続化が別 ID になり、同一 candidate だと判定できなくなるためです。

- hash 入力は `{ clusterKey, 正規化した evidence, policyVersion }` の 3 つだけである
- `subClusterKey` / `review_run_id` / 生成日時は hash に入れない（出力メタデータとしては保持する）
- prefix は `RR-PC-` で、`river promote propose` が採番する ID と同一である
- evidence は上流実装が NFC 正規化と重複排除を行う。`uniqueEvidenceCount` はその結果の件数である
- policy version は `CANDIDATE_POLICY_VERSION`（`'1'`）で共有する。未知の値は reject する

## 6. trust boundary（P1 では全件 untrusted）

集約が読む provenance は、すべて `.river/runs/*.json` の自己申告です。この保存先は被レビュー側の書き込み権限下にあり（`src/lib/result-store.mjs` の trust-boundary note）、`evidence_source: CI` や `trusted_by: github-actions` を検証なしに名乗れます。したがって P1 は次を固定します。

- `trust_level` は入力によらず常に `untrusted` である（`evidenceTrustLevel` は他の値を返さない）
- `provenance_verified` は常に `false` である
- `evidence.trustedRunCount` と `candidate.trust.trustedEvidenceCount` は常に 0 で、schema が `const: 0` で機械的に検証する
- `artifact_sha256` は同じレコードの self-digest である。コピー間の不一致は検出できるが、レコードを書き換えられる主体は digest も再計算できるため、真正性の証明にはならない
- 同一 `review_run_id` を名乗る run が複数あり得るため、`artifact_sha256` 昇順で先勝ちに固定し、衝突は `join.duplicateReviewRunIds` に出力する

`trusted_by` の署名・検証方式（CI attestation または人手承認記録）は契約1 の未決事項であり、P2 で確定します。trusted への昇格経路は、その検証機構が実装されるまで開けません。

## 7. 現時点の実データでの退行

canonical `review_run_id` と provenance の生産者は、まだリポジトリ内に存在しません。`buildFeedbackEntry` は `review_run_id` を書かず、`buildRunRecord` は `provenance` を書かず、finding は `category` を持ちません。そのため今日の実データに対しては次のように退行します。

- `join.joinedFeedbackCount` は 0 になり、candidate の `evidence` は空配列になる
- stage2 の `category` は `finding.ruleId`（発行元 skill id）へフォールバックする
- 反復の識別は PR 番号だけが担う

この状態は想定内で、テストでも「今日の実データ形状」として固定しています。値が埋まるのは契約2 の伝播（P1 以降で各生産者へ optional field を追加する作業）が進んでからです。

## 8. read-only の担保

- `src/lib/shadow-aggregate.mjs` 自体は fs / network を呼ばない。外部依存は `node:crypto` と、`promotion-candidates.mjs` の純粋な hash ヘルパー 2 つだけである
- CLI は書き込み系 option を提供しない
- candidate は `writeEffects: []` を宣言し、schema が `maxItems: 0` で検証する
- テストは対象リポジトリのファイル一覧・内容・mtime を実行前後で比較し、変化がないことを確認する

## 9. 次フェーズへの申し送り

- `trusted_by` の署名・検証方式は P2 で確定する（契約1）。それまで trusted 経路は閉じたままにする
- canonical `review_run_id` を saved run / feedback / Riverbed / eval ledger の各生産者へ伝播させる（契約2）
- stage2 の failure mode 語彙は、本コマンドの出力を数サイクル観測してから決める（契約5）
- profile の単位（reviewMode か、対象リポジトリ×phase の組か）は P2 で受入基準を決めるときに確定する（契約6）

## 10. 参照

- `docs/development/1574-p0-design-contract.md`: P0 設計契約 6 点
- issue #1574: Review Evolution Cycle Epic
- `src/lib/result-store.mjs`: run store の trust-boundary note
