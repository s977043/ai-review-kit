# Skill Pack 設計方針（オープンナレッジの梱包配布）

> Status: Draft（本ドキュメントは Epic 0 / Epic 4 の具体化です）
> Related: ROADMAP.md「Epic 0: Official Skill Pack」「Epic 4: Skill Authoring and Governance」、#1045

## 1. 背景と目的

River Review のポジションを「AI エージェントにチーム所有のレビュー判断を供給する OSS」として明確化します。
その実体として、オープンなレビューナレッジ（TypeScript レビュー、DDD レビューなど）を **pack として梱包済み** の状態で配布します。

導入直後のユーザーが skill を自作しなくても、pack を選ぶだけでレビューが機能する状態をゴールとします。

- 公開知（言語イディオム、設計手法、a11y などの一般基準）は公式 pack として配布する
- チーム固有知（自社ポリシー、ロールアウト基準など）だけをユーザーが書く
- pack は fixture / eval を伴う「テスト済みナレッジ」として品質を担保する

## 2. 方針（3 原則）

### 原則 1: pack は配布単位、tag は横断軸

pack・tag・phase の役割を混ぜないことが、軸の直交性を守る前提になります。

- pack = ユーザーが選択・導入する単位（例: `typescript`, `ddd`）
- tag = 横断検索の軸（例: `security`, `testing`）。pack をまたいで付与できる
- phase / category = pack 内の各 skill が個別に持つ実行フェーズの区分。pack manifest 自体は持たない

1 skill は複数 pack に属してもよい設計です。複数 pack を同時に指定した場合は、skill id で set-union して **1 skill を 1 回だけ実行** します（重複 finding・トークンの二重コストを防ぐ）。

### 原則 2: 既存機構の上位互換として導入する（非破壊）

registry.yaml の `recommendations:` は、すでに名前付き skill set として `--skill-set` から参照されています（`runners/core/skill-loader.mjs` の `resolveRecommendationSet`）。
pack はこの仕組みを置き換えるのではなく、メタデータを拡張した後継として定義します。併存に伴う仕様は次の通りです。

- skill ファイルの物理移動は行わない（path 変更なし、既存利用者に影響しない）
- pack manifest は skill を id の静的リストで参照する。存在しない id は validate でエラーにする
- `--skill-set <pack-id>` の既存 UX をそのまま pack の選択手段にする
- **解決順序**: packs を先に検索し、見つからなければ recommendations にフォールバックする
- **同名衝突の扱い**: 移行期間（Phase B〜C）中は packs 優先の解決順序で動作を保ちつつ、validate は警告に留める。既存の `recommendations.typescript` 等は deprecated 注記付きで残し、利用者の移行猶予を確保する。Phase D で recommendations 側を削除し、以後の同名衝突はエラーに昇格する
- 併存期間中、recommendations への新規追加は凍結する（Phase B で宣言）

注意: recommendations は「id をキーとするオブジェクト」、packs は「id フィールドを持つ配列」で形式が異なります。
このため Phase B では `runners/core/skill-loader.mjs` の resolver 拡張が必要であり、「軽微な変更」ではありません（§6 の見積もりに反映済み）。

### 原則 3: fixture-backed quality gate

「テスト済みナレッジ」が、プロンプト集との差別化点です。tier 昇格の条件として次を使います（§4）。

- pack 内の **各 skill** に good / bad fixture と golden output がある（S1 convention: 2026-05 retrospective 由来。定義の明文化は Phase B で行う）
- pack 内の各 skill に false-positive canary がある（既知の誤検出パターンの回帰防止）
- `npm run eval:fixtures` が CI で green である

ただし機械判定は **昇格の必要条件** であり、十分条件ではありません。
fixture は著者の自己採点になり得るため（トリビアルな fixture や過適合でゲーミング可能）、official への昇格には maintainer review を 1 回挟みます。

さらに、eval パイプライン自体がこの設計の単一障害点になるため、「ゲートのゲート」を設けます。
意図的に品質の低い canary pack を registry 外に常置し、それが official 判定を **通らない** ことを CI で確認します（Phase B）。

## 3. 軸定義

pack はいずれか 1 つの軸に分類します。軸をまたぐ関心は tag で表現します。
なお axis は分類メタデータであり、実行を制約するものではありません（tag による実行フィルタは Phase D 候補とします）。

| 軸             | 例                                  | 主な phase            | 特性                                          |
| -------------- | ----------------------------------- | --------------------- | --------------------------------------------- |
| 技術スタック軸 | `typescript`, `nextjs`, `laravel`   | midstream 中心        | 決定論寄りで fixture が書きやすい             |
| 設計手法軸     | `ddd`, `event-driven`, `api-design` | upstream 中心         | 文脈依存。plan / ADR アーティファクトに当てる |
| 横断関心軸     | `security`, `a11y`, `adversarial`   | 複数 phase にまたがる | 既存の recommendations と最も近い             |

設計手法軸（DDD など）は diff 単体への適用だと誤検出リスクが高いため、upstream の artifact（plan / ADR / pbi-input）と突き合わせる設計を標準とします。
この方針は artifact-input-contract を持つ River Review 固有の勝ち筋です。

ただし artifact を持たないライトユーザーへ pack が無価値・有害にならないよう、設計手法軸の pack には **degraded mode** を必須とします。

- artifact 必須の skill は、artifact 欠如時に `NO_REVIEW` で skip し「plan を渡すと精度が上がる」と案内する
- diff 単体でも安全に動く軽量 skill（例: ユビキタス言語の命名チェック）を 1〜2 個含め、空振りを防ぐ

### skill インベントリ方針（2026-06-10 監査で確定）

リポジトリに置く skill は「アーティファクトを評価・検査するもの」を原則とします。次の例外と境界を定めます。

- **テスト関連の生成・実行 skill（code-\*（test scaffold 系）7 件、Playwright 系 2 件）は review-adjacent として残す**。レビュー指摘（カバレッジギャップ等）への修正提案としてテスト追加を支援する位置づけであり、`review-support` tag で検査系と区別する
- 汎用コードレビュー系の重複 skill は plugin の `river-review-code` に統合する（agent-code-review の多観点実行・件数制約、agent-code-quality の命名・カプセル化観点を統合済み）
- 計画「作成」（旧 create-plan）は PlanGate の責務として移管完了（PlanGate#523 で受け入れ、2026-06-11 に本リポジトリから削除）。以降は plan を検査する側の skill のみ持つ
- レビューと無関係な汎用開発ガイド（ドキュメント執筆・リファクタ手順）は持たない
- plugin commands の `/check` / `/pr` は review-adjacent として **維持** する（2026-06-10 決定）。`/check` はレビュー前のハーネス検証（決定論チェックを先に走らせ AI レビューを高次判断に集中させる）、`/pr` は検査 skill `pr-description` とペアを成す「レビュー可能な PR 本文」の生成側という位置づけである

## 4. 成熟度 tier

pack 単位の成熟度として `tier` を新規導入します。既存フィールドとの関係は次の通りです。

- skill 個別の `recommended: true/false` は従来通り skill 単位のフラグとして残す（pack tier とは独立）
- skill の `tags: [community]` は「コミュニティ提供」という出自を表し、pack の `tier: community`（成熟度）とは別概念である。混同を避けるため、pack 文脈の文章では「community tier」と必ず修飾する

| tier           | 条件                                                                  | 配布上の扱い                   |
| -------------- | --------------------------------------------------------------------- | ------------------------------ |
| `official`     | §2 原則 3 の機械条件をすべて満たし、かつ maintainer review を通過した | カタログ先頭に掲載、既定で推奨 |
| `community`    | 機械条件のうち fixture はあるが canary / eval が不完全                | opt-in 提案として掲載          |
| `experimental` | 上記未達（アイデア段階）                                              | カタログに注記付きで掲載       |

community までの判定は機械条件のみで行い、official のみ人間ゲートを 1 回挟みます。
tier の自動判定スクリプト（pack 単位で全 skill の条件充足をチェック）は Phase C で追加します。

## 5. pack manifest スキーマ案

registry.yaml に `packs:` セクションを追加します。

```yaml
packs:
  - id: typescript
    version: '0.1.0'
    name: 'TypeScript Review Pack'
    description: 'TypeScript の型安全・null 安全・型駆動設計のレビュー基準'
    axis: technology # technology | methodology | concern（単一値）
    tier: official # official | community | experimental
    sources:
      - name: 'TypeScript Handbook'
        version: 'TS 5.x'
        url: 'https://www.typescriptlang.org/docs/handbook/'
        reviewed_at: '2026-06-10'
    skills:
      - typescript-strict
      - typescript-nullcheck
      - type-driven-design
```

設計上のポイントは次の通りです。

- `sources` は構造化フィールド（name / version / url / reviewed_at）とし、schema で必須化する。`reviewed_at` が一定期間（目安 6 ヶ月）を超えた pack には `skills:audit` で警告を出し、write-only metadata 化を防ぐ。外部出典を持たないオリジナル pack では `name: 'river-review original'` のような内部出典を許容する（url は省略可、reviewed_at は必須）
- `version` は pack 単位の SemVer とする。参照先 skill の内容が変わったら pack の patch bump を推奨し、validate は skill 更新と pack 更新の不整合を **警告**（エラーではない）として報告する。厳密な再現性が必要になった場合の git hash ベースの pin は将来検討とする
- `axis` は schema 上 enum の単一値として強制する
- スキーマは `schemas/pack.schema.json` として追加し、`skills:validate` に統合する（Phase B）。required は `id` / `version` / `name` / `description` / `axis` / `tier` / `skills` とする

テンプレートは `scripts/templates/pack/pack.yaml` に配置します。

## 6. 導入プロジェクト側の selection 宣言

導入プロジェクトが「どの pack / tag / skill を使うか」を宣言する場所として、既存の `.river-review.yaml`（ConfigLoader + Zod 検証）に `selection` セクションを追加します。
新しい設定ファイル形式（.env 風など）は導入しません。選択は配列と除外を含む構造化データであり、既存 config への統合が保守性で優位なためです。

```yaml
selection:
  packs: # pack 単位の導入（複数指定は skill id で set-union）
    - typescript
  tags: # tag による横断追加
    - a11y
  skills:
    include: # pack 外の個別 skill を追加
      - loading-state
    exclude: # pack に含まれるが使わない skill を除外
      - typescript-strict
  minTier: community # この tier 未満の pack を既定で除外
```

設計上のルールは次の通りです。

- 優先順位は `exclude > include > packs / tags の union` とする
- `minTier` は **tags による暗黙追加にのみ** 適用する。`packs:` に明示指定した pack は minTier 未満でも実行する（明示は意図的な選択とみなす）。その際は tier 不足の警告をログに出す
- selection は「実行するか」の宣言であり、suppression（finding 単位の抑制）とは役割を分ける
- CLI の `--skill-set` は selection の一時上書き手段として位置づけ直す
- 環境変数（`RIVER_PACKS` 等）は CI での一時上書き用の補助とし、SSoT は `.river-review.yaml` とする
- ユースケース別のサンプルは `examples/selection/` に配置する（React + TypeScript / TDD / SDD など）

selection の resolver は Phase B の pack resolver と同時に設計します。tag 実行フィルタ（旧 Phase D 候補）は selection の一部として実装する方が一貫するため、§7 の通りスコープを再配置します。

## 7. 実行計画

| Phase | 内容                                                                                                                                                                        | 変更範囲                                         |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| A     | 本方針・軸・テンプレートの合意 + selection 設計とユースケース別サンプル                                                                                                     | docs / specs / examples のみ                     |
| B     | 第 1 号 `typescript` pack + `schemas/pack.schema.json` + resolver 拡張（packs 優先・衝突警告・複数指定の set-union・selection 読み込み）+ ゲートのゲート canary + S1 明文化 | registry.yaml / schemas / runners/core / scripts |
| C     | 第 2 号 `ddd` pack（upstream 軸の実証、degraded mode 込み）+ tier 自動判定スクリプト                                                                                        | skills / registry.yaml / scripts                 |
| D     | カタログ生成（`skills:catalog` 拡張）、pages/ への公開ドキュメント、README 訴求更新、recommendations の deprecation 判断、tags 実行フィルタの selection への実装            | scripts / pages / README                         |

Phase B は loader（`runners/core/skill-loader.mjs`）と検証スクリプトに踏み込むため軽微ではありません。
AGENTS.md の「Ask before editing」に従い、`src/` / `runners/` に触れる変更は個別 PR で承認を取ります。
Phase C の DDD pack は「plan / 設計レビューに効く」という River Review 固有の価値を示すショーケースとして位置付けます。

## 8. 非ゴール

- 既存 94 skill の物理的なディレクトリ再編（参照で束ねるため不要）
- pack の外部レジストリ / リモート配布（npm 配布は Epic 1 で別管理）
- `recommendations:` の即時廃止（互換期間を置く。新規追加凍結は Phase B、廃止判断は Phase D）
- pack 単位の suppression。suppression / feedback は従来通り **skill 単位**（pack 非依存）で管理する。pack 固有の調整が必要になった場合は skill の fork で対応する

## 9. Phase D 判断記録（2026-06-10）

- **recommendations の廃止判断**: 即時削除はせず、**次 major リリース（v2.0.0）で削除** する。それまでは現状の運用（新規追加凍結 + pack 優先解決 + 衝突警告 + DEPRECATED 注記）を継続する。理由は、プラグイン / GitHub Actions 利用者の `--skill-set basic` 等の既存導線を minor リリースで壊さないため
- tags による実行フィルタは selection 実装（Phase B の resolver 拡張で導入済みの設計）に統合済みのため、独立タスクとしてはクローズ

## 10. 検証記録（2026-06-10）

本ドラフトは technical / consistency / adversarial の 3 視点並列セルフレビューを実施し、次の主要指摘を反映済みです。

- recommendations（オブジェクト）と packs（配列）の形式差により resolver 拡張が必要である点を §2 / §6 に明記（technical: blocker 相当）
- 同名 id 衝突（例: `typescript`）の解決順序と validate エラー化を §2 に追加（adversarial: high）
- 複数 pack 併用時の set-union / 重複実行防止を §2 原則 1 に追加（adversarial: high）
- tier 昇格を「機械判定 = 必要条件、official のみ maintainer review」に修正（adversarial: high）
- eval パイプラインの SPOF 対策として「ゲートのゲート」canary を §2 原則 3 と Phase B に追加（adversarial: critical）
- DDD pack の degraded mode を §3 に追加（adversarial: medium）
- `sources` の構造化と `skills:audit` 警告による形骸化防止を §5 に反映（adversarial: medium）
- tier / recommended / community タグの用語整理を §4 に追加（consistency: high）
