# 根拠追跡性レビュー定義（エージェント向け）

> **出典**: [pages/reference/review-policy.md](../../pages/reference/review-policy.md) Section 1.2「根拠追跡性」
> エージェント・プロンプトから参照するための内部向け定義。人間向けの要約は出典を参照。
> 検討の経緯は Issue #1783（Phase 0 の gap analysis と案 C の採択）を参照。

## この文書の位置づけ

本文書は **doc レベルの語彙定義**です。コード・スキーマ・レジストリは変更しません。

- 新しい schema ブロック（`rationale_traceability` など）は追加しない。finding は既存の [Finding フィールド](./output-format.md#finding-フィールド)のまま表現する。
- 新しい severity 語彙は作らない。内部語彙 `blocker` / `warning` / `nit` と出力スキーマの対応は `.claude/rules/review-core.md`「Severity の語彙マッピング」を唯一の正本とする。
- 新しい状態語彙は作らない。入力欠損・未確認・不要の区別は既存の `NO_REVIEW` / `skippedSkills` / Unknown Coverage の `evidence_missing` へ写像する。
- 独立した review gate は追加しない。既存 gate を横断する Lens として扱う（[Reviewer Lens Taxonomy](../../pages/explanation/reviewer-lens-taxonomy.md)）。

## 1. レビュー定義 / How・What・Why・Why not

知識をどの成果物へ置くかの原則は次のとおりです。文書量ではなく、判断に必要な知識が適切な場所にあるかを見ます。

| 軸          | 正本となる成果物      | レビューの問い                                                         |
| ----------- | --------------------- | ---------------------------------------------------------------------- |
| **How**     | コードそのもの        | 名前・型・責務・境界から実現方法を読み取れるか                         |
| **What**    | テスト                | 実装から独立した外部契約・境界条件・不変条件を固定できたか             |
| **Why**     | Issue / Plan / PR     | この変更が必要な理由を追跡でき、差分と一致しているか                   |
| **Why not** | コメント / ADR / Plan | 再検討されやすい不採用理由と制約が、判断の範囲に合う場所に残っているか |

### 1.1 How—コード構造

- 名前・型・責務・境界から実現方法を理解できる。
- 変更理由の異なる概念を、表面的な DRY で結合していない。
- 条件分岐・抽象化・継承が現在の複雑性に見合っている。
- コメントを消すと処理を追えなくなるほど、コードが不明瞭ではない。

### 1.2 What—テストと観測可能な振る舞い

- テストが公開契約・業務ルール・境界条件・不変条件を表現している。
- private メソッド・内部呼び出し順・偶然のデータ構造を不要に固定していない。
- 外部振る舞いが同じリファクタリングで壊れるテストになっていない。
- 異常系・境界・失敗時の振る舞いが不足していない。

### 1.3 Why—問題と採用した変更

- 変更が必要な理由を Issue / Plan / PR から追跡できる。
- Why と実際の差分が一致し、解決対象外の変更が混入していない。
- squash 後にも重要な Why を残す成果物が存在する。

> **commit は本 Lens の入力に含めません。** commit は [artifact 入力契約](../../pages/reference/artifact-input-contract.md)の対象アーティファクト一覧に無く、River Review は commit 履歴を入力として受け取りません。したがって「重要な Why が commit にしかない」という判定はできず、Taxonomy からも除外しています（#1783 Phase 0 の確定事項）。

### 1.4 Why not—不採用の代替案と制約

- 自然に見える代替案を避けた理由が、必要な場合に残っている。
- workaround・意図的重複・非標準実装に、理由と撤去条件がある。
- 過去の制約が解消済みなのに、古い理由が実装を固定していない。

## 2. Finding Taxonomy（13 コード）

各指摘には、追跡しやすさのため次の **finding-id** を `[id=...]` として付与してよいものとします。付与は任意で、出力形式は従来どおり `<file>:<line>: <message>` を維持します。この方式は `skills/upstream/plangate-exec-conformance/SKILL.md` の finding-id 表に揃えており、新しい artifact やスキーマ列を要求しません。

| finding-id                    | 意味                                     | 既定 severity     | 主な写像先                                             |
| ----------------------------- | ---------------------------------------- | ----------------- | ------------------------------------------------------ |
| `HOW_UNCLEAR`                 | コードから How を理解しにくい            | nit / warning     | `river-review-code` の可読性・責務観点                 |
| `HOW_MISPLACED_IN_COMMENT`    | 実装の説明をコメントへ逃がしている       | nit               | Phase 2 以降の新規 skill（現時点で担当資産なし）       |
| `WHAT_IMPLEMENTATION_COUPLED` | テストが実装詳細へ密結合                 | warning           | `test-assertion-effectiveness` ほか downstream skill   |
| `WHAT_MISSING_BEHAVIOR`       | 必要な外部振る舞いが未固定               | warning           | `test-existence` / `coverage-gap`                      |
| `WHY_MISSING`                 | 変更理由を追跡できない                   | warning           | `assumption-resolution-trace`                          |
| `WHY_DIFF_MISMATCH`           | Why と差分が不一致                       | warning / blocker | `plangate-exec-conformance` の `design-deviation` ほか |
| `WHY_NOT_MISSING`             | 非自明な代替案の不採用理由がない         | warning           | `altitude-generalization` ほか midstream skill         |
| `WHY_NOT_STALE`               | 不採用理由・制約が古い                   | warning           | Phase 2 以降の新規 skill（現時点で担当資産なし）       |
| `RATIONALE_CONTRADICTED`      | 成果物の間で理由が矛盾                   | warning / blocker | `self-contradiction`                                   |
| `RATIONALE_DUPLICATED`        | 同じ説明が複数の正本を持つ               | nit               | 正本の概念が未定義のため Phase 2 以降で扱う            |
| `COMMENT_RESTATES_CODE`       | コメントがコードの逐語説明               | nit               | Phase 2 以降の新規 skill（現時点で担当資産なし）       |
| `TEMPORARY_WITHOUT_EXIT`      | 一時対応に撤去条件がない                 | warning           | Phase 2 で `heuristic-review.mjs` の決定論検出器へ     |
| `RATIONALE_INPUT_MISSING`     | 必要な入力成果物がレビューに渡っていない | （severity 省略） | `skippedSkills` への記録（finding 化しない）           |

finding-id は内部分類であり、機械可読な列としては出力しません。上流ワークフローが同名の分類を持つ場合も、River Review は自分の Taxonomy を写像先として扱い、ID 空間を所有しません。

## 3. severity ガイド

severity は文書の欠落そのものではなく、変更リスク・将来の誤変更確率・影響範囲で決めます。内部語彙のまま出力し、スキーマ側 `critical` / `major` / `minor` / `info` への変換は `.claude/rules/review-core.md` へ委ねます（不明値は fail-safe で `major`）。

| 内部語彙  | この Lens での判断基準                                                                                      |
| --------- | ----------------------------------------------------------------------------------------------------------- |
| `blocker` | セキュリティ・権限・データ破壊・公開契約の変更で Why を追跡できない。古い制約コメントが安全性の誤認を招く   |
| `warning` | 重要な設計判断の Why not 不足。テストの実装密結合で安全なリファクタリングが困難。成果物の間で理由が矛盾する |
| `nit`     | 命名・責務の改善で How を明瞭にできる。コメントが冗長である                                                 |
| （省略）  | 入力不足の報告や、判断材料を求める質問                                                                      |

## 4. `missing` / `unknown` / `not_required` の区別

3 状態は新語彙を作らず、既存の仕組みへ写像します。River Review は、見えていない情報を「存在しない」と断定しません。

| 状態           | 意味                                               | 既存の表現手段                                                                                                                                                            |
| -------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unknown`      | 成果物がレビュー入力に渡っておらず、存在も不明     | Pre-execution Gate で `NO_REVIEW` を返し、`skippedSkills` に記録する（[artifact 入力契約](../../pages/reference/artifact-input-contract.md)の「欠損時」挙動）             |
| `missing`      | 成果物を確認したうえで、必要な理由が書かれていない | finding として報告し、Unknown Coverage の `evidence_missing` に「どの証拠が無いか」と再現可能な検索語を書く（[output-format.md](./output-format.md) の Unknown Coverage） |
| `not_required` | 本 Lens の要求条件に当たらず、そもそも不要         | finding を出さない。要求条件は次節が定義する                                                                                                                              |

`unknown` を `missing` として報告することは、本 Lens の最も重大な誤検出です。成果物が渡っていない場合は `RATIONALE_INPUT_MISSING` として入力不足を報告し、理由の欠落を主張しません。

## 5. コメント・ADR を要求する条件と省略条件

コメントと ADR は一律には求めません。次の条件のときにだけ要求します。

### 要求する条件

- 複数の有力案を比較したうえで、標準的・短い・共通化された案を意図的に避けた。
- workaround・legacy 互換・性能制約・セキュリティ制約が実装を歪めている。
- 意図的な重複や非対称性が残り、将来の保守者が「揃えるべきだ」と誤解しやすい。
- 一時対応が入っており、撤去条件（Issue・期限・解消条件のいずれか）が必要である。

### 省略してよい条件

- 自己説明的なコードで、名前と型から How を追える。
- 軽微な変更・明確なバグ修正・既存パターン踏襲の追加である。
- Issue や Plan に簡潔な Why があり、差分と一致している。

### 提案の方向

指摘は「コメントを追加せよ」に倒しません。修正先の候補を、コード改善・Plan 補完・ADR 追加・コメント修正の順で検討し、最も適切な 1 か所を示します。逐語説明コメント（`COMMENT_RESTATES_CODE`）に対しては、追加ではなく削除またはコード改善を提案します。

なお、指摘対象の近くにあるコメントが設計意図を明記している場合の扱いは、[review-policy.md](../../pages/reference/review-policy.md) Section 3.1 の既定に従います。本 Lens はそこへ新しい例外を足しません。

## 6. generated / vendor の除外規則

生成物と外部取り込み物は直接評価しません。既存 skill が採る除外の記述に揃えます。

- ビルド成果物・生成物（`dist/**`・`*.map`・lockfile・自動生成 manifest）は Gate 判定とレビュー対象の双方から除外する。この規則は `skills/agent-skills/unknown-coverage-review/SKILL.md` と `skills/midstream/behavior-structure-separation/SKILL.md` の Pre-execution Gate に揃える。
- `node_modules/` 配下と `package-lock.json` は対象外とする（`skills/midstream/config-json/SKILL.md` の既定）。
- 生成物を除外した結果として、評価対象は生成元・wrapper・契約・テストへ移す。生成元が差分に無い場合は指摘せず、`skippedSkills` へ記録する。

## 7. 決定論チェックと意味的レビューの分界

`.claude/rules/review-core.md`「カスタム静的解析の False-positive 責務分界」に従い、機械判定できる事実は静的解析が持ち、AI レビューは意味的整合性に集中します。

| 区分           | 本 Lens での担当                                                                            |
| -------------- | ------------------------------------------------------------------------------------------- |
| 決定論チェック | 一時対応コメントの撤去条件の有無（`TEMPORARY_WITHOUT_EXIT`）、generated / vendor パスの除外 |
| 意味的レビュー | How の明瞭さ、What の固定対象、Why と差分の一致、Why not の要否、理由の stale・矛盾・重複   |

決定論側は Phase 2 で `heuristic-review.mjs` へ実装し、誤検出は canary テストで回帰防止します。意味的レビューを単純な正規表現で強制しません。

## 8. 責務境界

River Review は成果物と差分が契約を満たすかを独立にレビューし、findings を返します。GO / NO-GO、停止、承認、merge は担いません。契約の定義主体・承認・実行制御は上流ワークフロー（PlanGate）の責務です。

## 関連ドキュメント

- [レビュー観点](./viewpoints.md)—共通観点のフラットチェックリスト
- [レビュー出力形式](./output-format.md)—重要度ラベルと finding フィールド
- [Reviewer Lens Taxonomy](../../pages/explanation/reviewer-lens-taxonomy.md)—Lens 語彙の正本
- [artifact 入力契約](../../pages/reference/artifact-input-contract.md)—入力成果物と欠損時の挙動
