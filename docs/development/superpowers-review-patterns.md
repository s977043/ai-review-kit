# Superpowers 由来のレビューパターン（River Review 向け / #1223）

## ステータス

Issue #1223 の提案ドキュメントです。

本ドキュメントは、Superpowers を依存として取り込まず、かつ River Review の責務境界を変えずに、Superpowers 由来の考え方を River Review でどう評価するかを記録します。

**方針の方向性:** 実行ワークフローではなく、レビューパターンを取り込みます。

- PlanGate は実行ガバナンスを所有する。plan の作成・承認・stop/go ポリシー・TDD 要件・subagent 実行制御がその範囲である。
- River Review はレビュー判断を所有する。artifact の突合・findings・verdict・リポジトリ所有の再利用可能なレビュースキルがその範囲である。

これは既存の Review Gates 設計の決定に従います。River Review はレビューし、PlanGate はゲートする、という分担です。

## なぜ必要か

AI 実装の速度向上により、レビューのリスクは「コードがよく書けているか」だけから「実装が承認済みの意図と整合し続けているか」へと移りました。エージェント開発では diff 単体のレビューでは不十分です。

有用な River Review 実行は、次の問いに答えられるべきです。

- diff は、もっともらしいが異なる実装ではなく、承認済み plan を実装しているか。
- 実装は、計画した対象ファイルとスコープ外境界の内側に留まっているか。
- テストは plan で約束した test cases を満たしているか。
- high-risk 作業で、TDD が正しい順序（RED → GREEN → REFACTOR VERIFY）で行われた証跡があるか。
- task 単位の実装レポートと過去のレビューが尊重されているか。
- 複数 task の変更を統合した後、最終ブランチは一貫しているか。

Superpowers には、これらの問いを支える有用な運用パターンがあります。

- plan から task への分解
- task brief / report / review package の handoff
- task 単位のレビューループ
- TDD RED/GREEN の証跡
- 最終的な whole-branch レビュー

River Review はその実行ワークフローをコピーすべきではありません。これらのパターンをレビュースキルと artifact 契約へ翻訳すべきです。

## 取り込む対象

### 1. Plan Alignment Review

River Review は PlanGate conformance スキルを通じて関連能力を既に持っています。Superpowers 由来の改善は、レビュー語彙と finding 分類をより明示的にする点にあります。

#### 目的

承認済みの計画 artifact を実装 diff と突合します。

#### 入力

- `plan.md`
- `design.md` または ADR（存在する場合）
- `todo.md`
- `test-cases.md`
- diff / patch
- JUnit / coverage（存在する場合）

#### チェック項目

- `plan.md` の task 要件が diff に現れている。
- `design.md` または ADR の境界決定が尊重されている。
- 変更ファイルが計画した対象ファイルの内側にある、または明示的に正当化されている。
- スコープ外領域に触れていない。
- 計画したテストが存在し、約束した挙動を対象にしている。
- 新しい依存・抽象・モジュール・migration が計画済みか正当化されている。
- 計画外の機能追加が PR に隠れていない。

#### Finding 分類

| Finding id                    | 意味                                             | 典型的な severity |
| ----------------------------- | ------------------------------------------------ | ----------------- |
| `planned-but-missing`         | 計画した task または受入項目が未実装である。     | major / critical  |
| `implemented-but-not-planned` | diff が plan に無い挙動を追加している。          | major             |
| `target-file-violation`       | 変更ファイルが計画対象を正当化なく超えている。   | major             |
| `out-of-scope-change`         | diff が明示的に除外された領域に触れている。      | critical          |
| `design-deviation`            | 実装が承認済み design / ADR に矛盾している。     | major / critical  |
| `test-contract-missing`       | 計画した test case がテストや JUnit 証跡に無い。 | major             |
| `unexpected-dependency-added` | 依存が plan/design の正当化なく追加された。      | major             |
| `unjustified-abstraction`     | 新しい抽象が plan/design の根拠なく現れた。      | minor / major     |

#### 既存スキルとの対応

これは置き換えではなく、次の上に積み上げます。

- `rr-upstream-plangate-plan-integrity-001`
- `rr-upstream-plangate-exec-conformance-001`

近期の実装は次のいずれかになり得ます。

1. `rr-upstream-plangate-exec-conformance-001` を拡張する。
2. 焦点を絞った兄弟スキル（例: `rr-upstream-plan-alignment-001`）を追加する。

分類と証跡の語彙だけの変更なら選択肢 1 を優先します。task review package や TDD ledger など追加の artifact を要求し始めるなら選択肢 2 を優先します。

## 2. TDD Evidence Review

PlanGate は TDD 証跡を要求し記録できます。River Review はその証跡が意味あるものかをレビューすべきです。

### 目的

TDD を主張する実装に、妥当な RED/GREEN/REFACTOR VERIFY の証跡があるか、そしてその証跡が約束した test cases に対応するかを確認します。

### 入力

- `test-cases.md`
- `docs/working/TASK-XXXX/evidence/tdd/task-N-ledger.json`
- `docs/working/TASK-XXXX/evidence/verification/*.json`
- diff / patch
- JUnit（存在する場合）

### 期待される TDD フェーズ

| フェーズ          | 要求される意味                           | 妥当性ルール                                          |
| ----------------- | ---------------------------------------- | ----------------------------------------------------- |
| `tdd_red`         | 追加したテストが本番実装の前に失敗する。 | `exitCode != 0` かつ結論が期待される失敗を説明する。  |
| `tdd_green`       | 最小実装が対象テストを通す。             | `exitCode = 0` かつコマンドが該当テストを対象にする。 |
| `refactor_verify` | 整理後もテストと関連チェックが通る。     | `exitCode = 0`。refactor を行った場合に必須。         |
| `verification`    | TDD 以外の最終検証。                     | `exitCode = 0`。RED/GREEN を置き換えない。            |

### チェック項目

- high-risk / critical 作業に `tdd_red` と `tdd_green` の証跡がある。
- `tdd_red` が偶然 pass していない。
- `tdd_red` の結論が、無関係なランタイムエラーでなく期待される失敗を説明している。
- `tdd_green` が `tdd_red` で導入した挙動と同じものを対象にしている。
- refactor や整理が起きた場合に `refactor_verify` が存在する。
- テスト証跡が `test-cases.md` または受入基準に対応づけられる。
- テストが mock のみを assert し、ビジネス境界を見落としていない。

### Finding 分類

| Finding id                                | 意味                                                 | 典型的な severity |
| ----------------------------------------- | ---------------------------------------------------- | ----------------- |
| `missing-tdd-red`                         | TDD が必須だが RED 証跡が無い。                      | major             |
| `invalid-tdd-red`                         | RED 証跡が pass した、または無関係な理由で失敗した。 | major             |
| `missing-tdd-green`                       | 実装後に GREEN 証跡が無い。                          | major             |
| `missing-refactor-verify`                 | refactor が起きたが refactor 後の検証が無い。        | minor / major     |
| `tdd-evidence-not-linked-to-test-case`    | 証跡を計画した test case に対応づけられない。        | major             |
| `test-does-not-cover-acceptance-criteria` | テストはあるが約束した受入挙動を検証しない。         | major             |

### 既存スキルとの対応

これは置き換えではなく、次の上に積み上げます。

- `rr-upstream-plangate-verification-audit-001`
- 将来の `river review verify` ランタイム作業

近期の実装は新しい焦点スキルにすべきです。TDD 証跡は `review-self` / `review-external` の W チェックとは入力も妥当性ルールも異なるためです。

提案する id は次のとおりです。

```text
rr-upstream-plangate-tdd-evidence-001
```

## 3. Review Context Bundle

Superpowers は会話全体でなく task 固有のファイルを渡すことで context のドリフトを減らします。River Review も同じレビュー入力の原則を取り込むべきです。

### 目的

reviewer の入力を再現可能・検査可能・再実行可能にします。

### bundle レイアウト候補

River ネイティブ形式は次のとおりです。

```text
.review/
└── packages/
    └── task-001/
        ├── brief.md
        ├── implementation-report.md
        ├── diff.patch
        ├── evidence-ledger.json
        ├── tdd-ledger.json
        └── review-artifact.json
```

PlanGate 統合形式は次のとおりです。

```text
docs/working/TASK-XXXX/
├── plan.md
├── design.md
├── test-cases.md
├── evidence/
│   ├── verification/
│   └── tdd/
└── dispatch/
    ├── task-001-brief.md
    ├── task-001-report.md
    └── task-001-review-package.md
```

### Review Artifact スキーマの決定

スキーマ v1 に必須のトップレベル `contextBundle` フィールドを**追加しない**こと。

理由は次のとおりです。

- `review-artifact.schema.json` v1 は既に安定しており、意図的に additive である。
- review bundle 対応は、まず入力契約の関心事である。
- v1 は契約を検証する間、実験的データを `debug.execution.snapshot` や外部 artifact で運べる。

推奨する道筋は次のとおりです。

1. 受け入れる artifact 名を `artifact-input-contract` または新しい開発提案に文書化する。
2. スキルが bundle ファイルを任意 artifact として消費できるようにする。
3. 利用が安定したら、形式的な `contextBundle` / `artifacts` セクションを持つ `review-artifact.v2.schema.json` を検討する。

## 4. Final Whole-Branch Review

Superpowers は task 単位のレビューの後に最終的なブランチレビューを行います。River Review はこれを自動マージ承認でなく downstream レビューに対応づけるべきです。

### 目的

複数の task 単位の変更が、統合後も一貫したブランチを成すかを確認します。

### 入力

- 全 diff
- task review package
- 過去の River Review artifact
- review-self / review-external
- evidence ledger
- plan / design / test-cases

### チェック項目

- task 単位の findings が解決済みか、明示的に保留されている。
- task 間に統合上の矛盾が現れていない。
- ブランチ単位の受入基準がカバーされている。
- 個別には安全な task の組み合わせで migration / 依存 / セキュリティのリスクが生まれていない。
- 過去のレビュー指摘が無視されていない。

### 出力

これは findings と `decision` / `suggestedLoopSignal` のみを生成すべきです。GO / NO-GO、C-3 承認、自動マージを行ってはなりません。

## 責務境界

| 領域             | PlanGate                     | River Review              |
| ---------------- | ---------------------------- | ------------------------- |
| Plan 作成        | 所有                         | artifact として読む       |
| Design 承認      | 所有                         | design 逸脱を検出         |
| Exec の開始/停止 | 所有                         | 制御しない                |
| TDD 要件         | 所有                         | 証跡の妥当性をレビュー    |
| Subagent 実行    | 所有                         | report/package をレビュー |
| Diff レビュー    | 補助                         | 所有                      |
| Findings 生成    | 補助                         | 所有                      |
| GO / NO-GO       | 人間 / 呼び出し元 / PlanGate | 助言のみ                  |
| 自動マージ       | しない                       | しない                    |

## 取り込み計画

### Phase 1: ドキュメントと分類

- 本提案を記録する。
- finding id を既存スキルと整合させる。
- Plan Alignment を `exec-conformance` の拡張にするか兄弟スキルにするかを決める。
- TDD Evidence Review を新規スキルにするかを決める。

### Phase 2: 最小のスキル作業

- Plan Alignment レビュースキルを更新または追加する。
- 次の fixture と golden 出力を追加する。
  - planned-but-missing
  - implemented-but-not-planned
  - out-of-scope-change
  - test-contract-missing

### Phase 3: TDD 証跡レビュー

- `rr-upstream-plangate-tdd-evidence-001` を追加する。
- 次の fixture と golden 出力を追加する。
  - missing-tdd-red
  - invalid-tdd-red
  - missing-tdd-green
  - tdd-evidence-not-linked-to-test-case

### Phase 4: Review Context Bundle

- artifact の入力名を定義する。
- ドキュメントと例を追加する。
- スキーマ v2 に形式的な bundle メタデータが必要かを決める。

## 非目標（Non-goals）

- Superpowers を依存として取り込まない。
- Superpowers のスキルファイルをコピーしない。
- River Review に実装 task を実行させない。
- River Review に PlanGate の C-3 承認を行わせない。
- River Review に実行の直接的な block / unblock をさせない。
- 自動マージを追加しない。
- すべての PR に TDD を必須化しない。

## 未決事項（Open questions）

1. Plan Alignment は `rr-upstream-plangate-exec-conformance-001` の拡張にすべきか、新規の兄弟スキルにすべきか。
2. TDD Evidence Review は upstream・verify・その両方のどれにすべきか。
3. Review Context Bundle は、最初の一手として River ネイティブ（`.review/packages`）にすべきか、PlanGate 統合（`docs/working/TASK-XXXX/dispatch`）のみにすべきか。
4. bundle はスキーマ v2 の概念にすべきか、artifact resolver の関心事に留めるべきか。

## 初期の推奨

- Plan Alignment の分類と語彙のためだけに `rr-upstream-plangate-exec-conformance-001` を拡張する。
- TDD 証跡のために新規の `rr-upstream-plangate-tdd-evidence-001` スキルを追加する。
- Review Context Bundle はスキーマ v1 の外に置く。
- Final Whole-Branch Review は downstream の助言レビューとして維持する。
