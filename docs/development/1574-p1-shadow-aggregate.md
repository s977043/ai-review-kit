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

| ファイル                               | 役割                                                    |
| -------------------------------------- | ------------------------------------------------------- |
| `src/lib/shadow-aggregate.mjs`         | 集約ロジック本体。I/O を持たない純関数群                |
| `src/cli/commands/evolve.mjs`          | `river evolve aggregate` のハンドラ。読み出しと出力のみ |
| `schemas/shadow-aggregate.schema.json` | 出力アーティファクトと candidate の JSON Schema         |
| `tests/shadow-aggregate.test.mjs`      | 契約準拠・決定性・read-only のテスト                    |

## 4. CLI

```bash
river evolve aggregate <path> [--min <n>] [--month YYYY-MM] [--output json]
```

- `--min`: stage1 の反復しきい値である（既定 2、#1568-A と同値）
- `--month`: 対象の feedback ファイルを `YYYY-MM` に限定する
- `--output json`: 機械可読な集約 JSON を出力する（既定は Markdown）

exit code は常に 0 です。P1 の出力は gate ではなく観測であるため、しきい値超過で失敗させません。

## 5. 設計契約との対応

| 契約                            | P1 での実装                                                                              | 実装箇所                                  |
| ------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------- |
| 契約1 evidence provenance       | run ごとに 7 フィールドを付与し、trusted / untrusted を fail-safe に判定する             | `buildRunEvidence` / `evidenceTrustLevel` |
| 契約2 canonical `review_run_id` | optional field を read 側で解決し、突合できた feedback 件数を報告する                    | `deriveReviewRunId` / `join`              |
| 契約3 Experiment Manifest       | P2 の範囲。P1 では実装しない                                                             | —                                         |
| 契約4 stable CLI / content ID   | `river evolve aggregate` を stable CLI とし、ID を証拠集合の content hash から生成する   | `computeCandidateId`                      |
| 契約5 two-stage clustering      | stage1 は `(skillId, feedbackType)`、stage2 は fingerprint / category / scope で分割する | `buildClusters`                           |
| 契約6 profile 別受入基準        | P2 の範囲。P1 では実装しない                                                             | —                                         |

補足:

- `evidence_source` が未記録の run は `local` として扱い、trust level は `untrusted` に倒す
- candidate 自身が生成した証拠（`generated_by_candidate: true`）は trusted に昇格しない
- fingerprint を持たない sub-cluster は表示だけ許可し、`experimentEligible: false` を立てる
- stage2 の `failureMode` は `null` 固定である。語彙は P1 の観測後に確定する契約のため、先取りしない
- candidate の `trust.canaryEligible` は P1 では常に `false` である

## 6. read-only の担保

- `src/lib/shadow-aggregate.mjs` は `node:crypto` 以外を import せず、fs へ触れない
- CLI は書き込み系 option を提供しない
- candidate は `writeEffects: []` を宣言し、schema が `maxItems: 0` で検証する
- テストは対象リポジトリのファイル一覧・内容・mtime を実行前後で比較し、変化がないことを確認する

## 7. 次フェーズへの申し送り

- 未決事項の `trusted_by` の署名・検証方式は P2 で確定する（契約1）
- stage2 の failure mode 語彙は、本コマンドの出力を数サイクル観測してから決める（契約5）
- profile の単位（reviewMode か、対象リポジトリ×phase の組か）は P2 で受入基準を決めるときに確定する（契約6）

## 8. 参照

- `docs/development/1574-p0-design-contract.md`: P0 設計契約 6 点
- issue #1574: Review Evolution Cycle Epic
- `src/lib/result-store.mjs`: run store の trust-boundary note
