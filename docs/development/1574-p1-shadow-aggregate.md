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

正常終了時の exit code は 0 です。P1 の出力は gate ではなく観測であるため、しきい値超過では失敗させません。ただし使い方の誤り（不明なサブコマンド・余剰引数・不明オプション・オプションの値欠落・未対応の `--output`）は exit 1 で明示的に失敗します（値欠落は #1709 Slice 2 で統一）。`river evolve agregate` のような typo を path として黙って受け取り、空の成功結果を返すことはありません。

## 5. 設計契約との対応

| 契約                            | P1 での実装                                                                                 | 実装箇所                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------- |
| 契約1 evidence provenance       | run ごとに provenance を記録しつつ、trust level は常に `untrusted` に固定する               | `buildRunEvidence` / `evidenceTrustLevel`    |
| 契約2 canonical `review_run_id` | optional field を read 側で解決し、突合できた feedback 件数を報告する                       | `deriveReviewRunId` / `join`                 |
| 契約3 Experiment Manifest       | P2 の範囲。P1 では実装しない                                                                | —                                            |
| 契約4 stable CLI / content ID   | `river evolve aggregate` を stable CLI とし、ID 導出は #1624 の実装へ一本化する             | `computeCandidateId`（#1624 の薄い adapter） |
| 契約5 two-stage clustering      | stage1 は `(skillId, feedbackType)`、stage2 は fingerprint / category / filePath で分割する | `buildClusters`                              |
| 契約6 profile 別受入基準        | P2 の範囲。P1 では実装しない                                                                | —                                            |

補足:

- `evidence_source` が未記録の run は `local` として扱う
- fingerprint を持たない sub-cluster は表示だけ許可し、`experimentEligible: false` を立てる
- 同じ fingerprint の feedback が複数行あっても 1 件の finding とみなす。`experimentEligible` は distinct な (run, PR) の件数で判定する
- stage2 の `failureMode` は `null` 固定である。語彙は P1 の観測後に確定する契約のため、先取りしない
- candidate の `trust.canaryEligible` は P1 では常に `false` である
- stage2 の第3軸は `filePath`（`finding.file`）である。#1648 で finding へ追加した `scope`（in-diff / pre-existing）とは別物のため、名前を分けている。`finding.scope` を集計軸へ取り込むかは今後の検討事項である

### shadow から propose への接続（収束の運用契約）

観測した candidate を永続化するときは、cluster 全体の JSONL ではなく **candidate の `sourceFeedbackRefs`** を `river promote propose --input` へ流します。stage2 のサブクラスタは evidence 集合が互いに異なるため、cluster 全体を流すとサブクラスタのどれとも一致しない第3の ID が生まれるためです。

```bash
river evolve aggregate . --output json \
  | jq -c '.candidate.sourceFeedbackRefs[]' > candidate-feedback.jsonl
river promote propose \
  --input candidate-feedback.jsonl \
  --cluster-key "$(river evolve aggregate . --output json | jq -r .candidate.clusterKey)" \
  --index .river/memory/index.json
```

- `sourceFeedbackRefs` の各要素は propose の入力契約（`validateFeedbackEntryShape`）を満たす形にしてある。`skillId` を含むのはこのためで、hash 入力ではないため candidate ID は変わらない
- 同一 evidence 集合からは、shadow 観測と propose 永続化が同一の `RR-PC-` ID へ収束する

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

`trusted_by` の署名・検証方式（CI attestation または人手承認記録）は契約1 の未決事項であり、P2 でも確定していません。確定は P3 以降です（出典: `docs/development/1574-p0-design-contract.md`）。trusted への昇格経路は、その検証機構が実装されるまで開けません。

## 7. 現時点の実データでの充足と退行

canonical `review_run_id` の生産者は v1.66.0（#1681）で実装しました。`river feedback add --run-id <id>` が feedback へ `review_run_id` を書きます。run record 側では `deriveReviewRunId` が既存の `runId` を canonical 値として解決するため、両者の突合が成立します。契約1 provenance の生産者も #1715 で実装しました。`buildRunRecord` が `commitSha` と `provenance` を書きます。finding の `category` だけは未実装で残っています。

充足済み（v1.66.0 以降）:

- `--run-id` を付けた feedback は `join.joinedFeedbackCount` に数えられ、candidate の `evidence` も埋まる
- occurrence キーは `(review_run_id, pr)` であり、run 単位で反復を数えられる。同一 PR への再 run に付けた feedback は別 occurrence になる
- 上記は `tests/shadow-aggregate.test.mjs` の producer 経路テストが join 2 件 / unjoined 0 件として固定している

充足済み（#1715 以降）:

- `river run --save` が保存した record は `commitSha` を持ち、`source_commit_sha` が実値になる
- `evidence_source` は実行環境の自己申告である。`GITHUB_ACTIONS=true` のとき `CI`、それ以外で `local` になる
- `trusted_by` は null に固定する。CI 実行を検証済み attestation とみなさないためである
- `trust_level` と `provenance_verified` は provenance を書いても変わらない。値は `untrusted` と `false` のままである
- provenance を持たない旧 record は従来どおり読める。値が無い record では `commitSha` と `provenance` のキー自体を書かない
- 上記は `tests/shadow-aggregate.test.mjs` の producer 経路テストが実 sha と trust 3 指標で固定している

`commitSha` の意味論には注意が必要です。ローカルの `river run` は**作業ツリー**と merge base を比較するため、未コミットの変更をレビューした場合、レビュー対象の行は HEAD のツリーに存在しません。`commitSha` は「レビューが乗っていたベースライン」であって「レビュー対象コードを含むコミット」ではありません。ローカルでは dirty が既定の状態です。

- `provenance.dirty` が両者を区別する。`git status --porcelain` が非空なら `true`、空なら `false` になる
- 判定不能のときは `null` である。観測していないツリーを clean と報告しないためである
- `source_commit_sha` を再現可能な参照として扱えるのは `dirty` が `false` のときだけである
- `dirty` は run record にだけ書く。aggregate の `runEvidence` は `additionalProperties: false` であり、公開には 2 スキーマの同時更新が要るため後続 slice へ回した

未充足（残作業）:

- finding が `category` を持たないため、stage2 の `category` は `finding.ruleId`（発行元 skill id）へフォールバックする
- `dirty` は aggregate の evidence へ出ない。`river evolve aggregate` からは run record を直接読まないと分からない

P1 実装の時点では `review_run_id` の生産者も存在せず、join が常に 0 でした。テストは旧形状と現形状の両方を固定しています。

### findingFingerprint の不一致（#1823）

`findingFingerprint` が run 側のどの finding とも一致しない feedback 行は、落とされません。`no-category` / `no-file-path` のまま独自の stage2 sub-cluster を作り、条件が揃えば別 candidateId の candidate まで生成します。v1 と v2 は同じ 16-hex 空間にあり、`river review --debug` から v2 値を貼ると無言でこの状態になります。

- 不一致は `join.unmatchedFindingFingerprints` に出力する。`join.unjoinedFeedbackCount`（契約2 の run id 突合）とは別の軸である
- 保存済み finding の v2 値だと判定できた分は `join.v2FindingFingerprints` にも出力する。判定は `classifyFingerprintAlgo`（`src/lib/finding-factory.mjs`）が run record の `fingerprintV2` を引いて行う
- `buildShadowAggregate` の `warn` sink は既定が no-op である。`river evolve aggregate` が `console.warn` を配線する
- `river feedback add --fingerprint` も貼った時点で同じ警告を出す。ただし助言であり、行は必ず書かれ exit code も変わらない

## 8. read-only の担保

- `src/lib/shadow-aggregate.mjs` 自体は fs / network を呼ばない。外部依存は `node:crypto` と、`promotion-candidates.mjs` の純粋な hash ヘルパー 2 つだけである
- CLI は書き込み系 option を提供しない
- candidate は `writeEffects: []` を宣言し、schema が `maxItems: 0` で検証する
- テストは対象リポジトリのファイル一覧・内容・mtime を実行前後で比較し、変化がないことを確認する

## 9. 次フェーズへの申し送り

- `trusted_by` の署名・検証方式は P3 以降で確定する（契約1・P2 でも未確定。出典: `docs/development/1574-p0-design-contract.md`）。それまで trusted 経路は閉じたままにする
- canonical `review_run_id` の伝播は feedback（#1681）で成立した。Riverbed entry と eval ledger への伝播は未着手である（契約2）
- stage2 の failure mode 語彙は、本コマンドの出力を数サイクル観測してから決める（契約5）
- profile の単位（reviewMode か、対象リポジトリ×phase の組か）は P3 以降で確定する（契約6）。P2 は profile 名だけを必須にし、単位は未決のまま残した。`river evolve replay` の出力を数サイクル観測してから決める（出典: `docs/development/1574-p0-design-contract.md`）

## 10. 参照

- `docs/development/1574-p0-design-contract.md`: P0 設計契約 6 点
- issue #1574: Review Evolution Cycle Epic
- `src/lib/result-store.mjs`: run store の trust-boundary note
