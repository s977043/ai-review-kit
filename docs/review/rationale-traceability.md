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

> **既定 CI 経路で必ず届く Why の入力は `prDescription` だけです。** 既定 runner の供給セットは `RUNNER_SUPPLIED_CONTEXTS = ['diff', 'prDescription', 'fullFile']`（`scripts/validate-skills.mjs:71`）です。Plan は artifact として供給された場合のみ読め、外部 Issue は取得も推測もしません（`skills/agent-skills/unknown-coverage-review/SKILL.md:65`）。したがって上表の「Issue / Plan / PR」は**理想的な配置先**であり、既定経路の**到達可能な入力**ではありません。届いていない入力について理由の欠落を主張することは、#1783 前提 2 が禁じる断定にあたります。
>
> **`WHY_COMMIT_ONLY` は Taxonomy へ入れません。** `commitMessage` は `inputContext` の enum に実在し（`schemas/skill.schema.json:68`）、本番 skill も宣言できます。しかし既定 runner はこれを供給しません（同じ `RUNNER_SUPPLIED_CONTEXTS`。`prDescription` は供給されるのに `commitMessage` は供給されないという実在の非対称）。既定 CI 経路で届かない入力に依存する finding code を定義すると、上と同じ断定を構造的に招くため、Phase 1 では定義しません。供給セットの拡張の是非は Phase 2 以降の検討事項として残します（#1783 Phase 0 の結論と、その[訂正コメント](https://github.com/s977043/river-review/issues/1783#issuecomment-5188233338)）。

### 1.4 Why not—不採用の代替案と制約

- 自然に見える代替案を避けた理由が、必要な場合に残っている。
- workaround・意図的重複・非標準実装に、理由と撤去条件がある。
- 過去の制約が解消済みなのに、古い理由が実装を固定していない。

## 2. Finding Taxonomy（13 コード）

各指摘には、追跡しやすさのため次の **finding-id** を `[id=...]` として付与してよいものとします。付与は任意で、出力形式は従来どおり `<file>:<line>: <message>` を維持します。この方式は `skills/upstream/plangate-exec-conformance/SKILL.md` の finding-id 表に揃えており、新しい artifact やスキーマ列を要求しません。

| finding-id                    | 意味                                     | 既定 severity     | 主な写像先                                                                                                 |
| ----------------------------- | ---------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------- |
| `HOW_UNCLEAR`                 | コードから How を理解しにくい            | nit / warning     | `river-review-code`（`inputContext: [diff, fullFile]` は既定供給セット内）                                 |
| `HOW_MISPLACED_IN_COMMENT`    | 実装の説明をコメントへ逃がしている       | nit               | 現時点で担当資産なし（Phase 2 以降）                                                                       |
| `WHAT_IMPLEMENTATION_COUPLED` | テストが実装詳細へ密結合                 | warning           | 現時点で担当資産なし（Phase 2 以降）                                                                       |
| `WHAT_MISSING_BEHAVIOR`       | 必要な外部振る舞いが未固定               | warning           | `test-existence` / `coverage-gap`。**既定 CI 経路では発火しない**（`RIVER_AVAILABLE_CONTEXTS` 拡張時のみ） |
| `WHY_MISSING`                 | 変更理由を追跡できない                   | warning           | 現時点で担当資産なし（Phase 2 以降）                                                                       |
| `WHY_DIFF_MISMATCH`           | Why と差分が不一致                       | warning / blocker | `plangate-exec-conformance` の `design-deviation` ほか。**明示呼び出し時のみ**（`recommended: false`）     |
| `WHY_NOT_MISSING`             | 非自明な代替案の不採用理由がない         | warning           | 現時点で担当資産なし（Phase 2 以降）                                                                       |
| `WHY_NOT_STALE`               | 不採用理由・制約が古い                   | warning           | 現時点で担当資産なし（Phase 2 以降）                                                                       |
| `RATIONALE_CONTRADICTED`      | 成果物の間で理由が矛盾                   | warning / blocker | 現時点で担当資産なし（Phase 2 以降）                                                                       |
| `RATIONALE_DUPLICATED`        | 同じ説明が複数の正本を持つ               | nit               | 現時点で担当資産なし（Phase 2 以降）                                                                       |
| `COMMENT_RESTATES_CODE`       | コメントがコードの逐語説明               | nit               | 現時点で担当資産なし（Phase 2 以降）                                                                       |
| `TEMPORARY_WITHOUT_EXIT`      | 一時対応に撤去条件がない                 | warning           | Phase 2 で `heuristic-review.mjs` の決定論検出器へ                                                         |
| `RATIONALE_INPUT_MISSING`     | 必要な入力成果物がレビューに渡っていない | （severity 省略） | 現時点で受け皿なし（Phase 2 以降）。既存の `skippedSkills` は代替にならない                                |

「現時点で担当資産なし」と書いた 8 コードは、既存 skill の Gate や Non-goals が対象を明示的に外しているため、既存資産へ写像できません。根拠は次のとおりです。

- `WHAT_IMPLEMENTATION_COUPLED`: `test-assertion-effectiveness` の 6 Check はすべて「アサーションが落ちない」側の欠陥であり、密結合は逆に「過剰に落ちる」側にあたる。委譲表（`SKILL.md:49-66`）にも該当行がない。
- `WHY_MISSING`: `assumption-resolution-trace` は plan 欠損時に発火しない（`SKILL.md:47` Non-goals）。`WHY_MISSING` が問題になるのは plan が無い変更であり、空振りする。同 `:43` により既定 CI でも自動発火しない。
- `WHY_NOT_MISSING`: `altitude-generalization` の Non-goals `SKILL.md:48`「差分に証拠のない主張は出さない」と正面衝突する。
- `RATIONALE_CONTRADICTED`: `self-contradiction` の Gate（`SKILL.md:42`）は差分内の宣言的フレーズを必須とし、成果物をまたぐ理由の矛盾は通らない。
- `RATIONALE_DUPLICATED`: 「正本」の概念自体は repo に存在する（`docs` / `pages` / `skills` / `.claude` に 13 箇所。測定コマンド: `grep -ro "正本" docs pages skills .claude | wc -l`）。無いのは**機械判定できる正本の同定手段**だけであり、Phase 2 で新しい正本概念を定義する必要はない。
- `RATIONALE_INPUT_MISSING`: `skippedSkills` は skill id 粒度の配列で、プランナーが実行**前**に構築する（`src/lib/review-plan.mjs:733-736`）。「実行中の skill がこの finding code の入力だけ欠いた」を追記する経路がない。
- `HOW_MISPLACED_IN_COMMENT` / `WHY_NOT_STALE` / `COMMENT_RESTATES_CODE`: コード内コメントを対象物とする資産が repo に存在しない（#1783 Phase 0 の全 skill 検索で 0 hit）。

### カバレッジ内訳（再集計）

判定基準は「**既定 CI 経路（`RUNNER_SUPPLIED_CONTEXTS`）で発火する担当資産があるか**」です。

| 判定                                                             | 件数 | finding-id                                    |
| ---------------------------------------------------------------- | ---- | --------------------------------------------- |
| 既定 CI 経路で発火する担当資産あり                               | 1    | `HOW_UNCLEAR`                                 |
| 条件付き（供給コンテキスト拡張時、または明示呼び出し時のみ）     | 2    | `WHAT_MISSING_BEHAVIOR` / `WHY_DIFF_MISMATCH` |
| 担当資産なし（Phase 2 以降で新規 skill / 決定論検出器 / 受け皿） | 10   | 上記以外の 10 コード                          |

Phase 0 の「完全 3 / 部分 7 / 未カバー 4」は SKILL.md 本文だけを見た判定であり、既定 runner の供給セットと各 skill の Gate を確認していないため過大評価でした。上表がその再集計です。

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

| 状態           | 意味                                               | 既存の表現手段                                                                                                                                                                                                          |
| -------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unknown`      | 成果物がレビュー入力に渡っておらず、存在も不明     | その観点をスキップし、`skippedSkills` に記録する（`NO_REVIEW` は返さない）。[artifact 入力契約](../../pages/reference/artifact-input-contract.md)の `pbi-input` / `plan` / `todo` / `test-cases` の「欠損時」挙動と同一 |
| `missing`      | 成果物を確認したうえで、必要な理由が書かれていない | finding として報告し、Unknown Coverage の `evidence_missing` に「どの証拠が無いか」と再現可能な検索語を書く（[output-format.md](./output-format.md) の Unknown Coverage）                                               |
| `not_required` | 本 Lens の要求条件に当たらず、そもそも不要         | finding を出さない。要求条件は次節が定義する                                                                                                                                                                            |

`unknown` を `missing` として報告することは、本 Lens の最も重大な誤検出です。成果物が渡っていない場合は入力不足として扱い、理由の欠落を主張しません。

rationale 系の正本（`plan` ほか）が欠損しても、本 Lens 全体を停止させてはいけません。`plan` を持たない adopter でも動くことは River Review の設計原則であり、`skills/agent-skills/unknown-coverage-review/SKILL.md:64` が「PlanGate 非依存」として明示しています。欠損した観点だけをスキップし、残る観点は差分と `prDescription` で評価します。

なお `RATIONALE_INPUT_MISSING` を記録する受け皿は現時点で存在しません。`skippedSkills` は skill id 粒度で実行前に構築される配列（`src/lib/review-plan.mjs:733-736`）であり、finding code 単位の入力不足を書き込めません。Phase 2 でこの受け皿を設計するまで、本コードは分類語彙としてのみ用います。

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

上の 2 つは **Gate 判定とプロンプト最適化の除外**です。**finding 出力段の抑制**はこれとは別概念で、範囲がより狭くなっています。`src/lib/diff-processor.mjs:40-56` は、出力段の抑制対象を生成ディレクトリ（`EXCLUDED_DIR_RE`）だけに限り、`.md` と lock file を意図的に外しています。lock file 上の実在する finding を黙って隠さないためです。Phase 2 で除外を実装するときは、どちらの段の除外かを明示してください。

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
