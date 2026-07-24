# レビュー出力形式（エージェント向け）

> **出典**: [pages/reference/review-policy.md](../../pages/reference/review-policy.md) Section 2 + 6
> エージェント・プロンプトから参照するための内部向け仕様。人間向けの詳細は出典を参照。

## 構造

### 1. Summary（要約）

- 変更内容の要点
- 主要な懸念事項
- 全体評価（良い点と改善点のバランス）

### 2. Comments（具体的指摘）

各指摘に以下を含める:

- **対象箇所**: `<file>:<line>`
- **問題点**: 何が問題か、なぜ問題か
- **影響**: 引き起こす可能性のある影響
- **重要度**: 下記の優先度ラベル

### 3. Suggestions（改善提案）

- 具体的な改善案・代替実装
- コード例やリファクタリング方向性

### 4. 補助セクション（任意 / #1196 S2）

レビューの判断材料を高めるため、必要に応じて以下を Summary の後に添える。いずれも**任意**で、finding スキーマ・severity 体系は変更しない（後方互換）:

- **Good Points（良い点）**: 妥当な設計判断・適切なテスト追加など、維持すべき点。レビューが指摘一辺倒にならないようにする
- **Missing Tests（不足テスト）**: 追加すべきテスト観点（正常系で抜けている異常系・境界・回帰）。finding 化しにくい「テストの不在」を可視化する
- **Follow-up Issues（フォローアップ）**: 本 PR のスコープ外だが別途追跡すべき課題。Blocker でない Major を別 Issue で追う運用と接続する
- **Unverified / Residual Risk（未確認事項・残リスク）**: レビュー時点で検証しきれなかった前提・観測できなかった挙動・残る懸念を、finding とは別にレポート全体として明示する。判断の限界を後から追跡可能にする
  - **Unknown Coverage（残存 Unknown / evidence_missing / resolution）**: 残リスク節の下位構造。レビュー時点で残る Unknown を構造化して並べるブロックである。各 Unknown 項目は category・severity・blocking・evidence_missing（不足している証拠）・resolution（解消手順）を持つ。確認済みで受容したリスクと未確認のリスクを区別し、解消済み Unknown には根拠（evidence: リンク済み受入条件・テスト等）を関連付ける。verdict への写像は [loop-convergence-contract.md](../../pages/reference/loop-convergence-contract.md) の写像表に従う（新語彙は作らない）

> これらは人間/エージェントが読む要約セクションであり、機械可読な finding は引き続き Comments（severity 付き）で表現する。

## 重要度ラベル

| ラベル   | 定義                                                         |
| -------- | ------------------------------------------------------------ |
| Critical | セキュリティ脆弱性、データ損失リスク、システムダウンの可能性 |
| Major    | 重大なバグ、パフォーマンス問題、設計上の大きな問題           |
| Minor    | 小さなバグ、可読性の問題、軽微な最適化の機会                 |
| Info     | 提案、参考情報、追加の検討事項                               |

> **ドキュメント実害は Major**（#1069）: 実行例（コマンド / コード）が動かない・正本と矛盾する記載・主要導線のリンク切れは、字面は軽微に見えても「公式手順が機能不全」となるため **Major** として扱う（Minor に落とさない）。表記ゆれ・誤字・体裁など実行に影響しないものは Minor。

## Finding フィールド

各指摘（finding）が持つフィールドの一覧。`id`・`ruleId`・`title`・`message`・`severity`・`phase`・`file` は必須。

| フィールド   | 型              | 必須 | 説明                                                           |
| ------------ | --------------- | ---- | -------------------------------------------------------------- |
| `id`         | `string`        | Yes  | ランスコープ内のユニークな識別子。                             |
| `ruleId`     | `string`        | Yes  | 指摘を生成したルール / スキルの識別子。                        |
| `title`      | `string`        | Yes  | 指摘の短いタイトル。                                           |
| `message`    | `string`        | Yes  | 問題の詳細説明。                                               |
| `severity`   | `string`        | Yes  | 重要度。`critical` / `major` / `minor` / `info`。              |
| `phase`      | `string`        | Yes  | SDLC フェーズ。`upstream` / `midstream` / `downstream`。       |
| `file`       | `string`        | Yes  | 対象ファイルパス。                                             |
| `line`       | `integer`       | No   | 指摘に関連する開始行番号。                                     |
| `lineEnd`    | `integer`       | No   | マルチライン指摘の終了行番号。                                 |
| `confidence` | `string`        | No   | 指摘の信頼度。`high` / `medium` / `low`。                      |
| `status`     | `string`        | No   | ライフサイクルステータス。`open` / `suppressed` / `verified`。 |
| `evidence`   | `array<string>` | No   | 指摘を支持する証拠スニペットの配列。                           |
| `reviewer`   | `string`        | No   | 指摘を生成したスキル / エージェントの識別子。                  |
| `suggestion` | `string`        | No   | 修正や後続アクションのヒント。                                 |
| `scope`      | `string`        | No   | 指摘が差分の追加行に由来するか。`in-diff` / `pre-existing`。   |

> `scope` は additive なメタデータです（#1644 Phase 1）。verifier がパース済み差分の追加行と finding の行範囲を突き合わせて決定論的に判定し、判定できない場合のみレビュアーの自己申告（`Scope:` ラベル）を採用します。追加行のみが `in-diff` であり、unified diff の context 行は `pre-existing` として扱います（行の許容幅は 0）。未指定・不明値は fail-safe の `in-diff` とし、指摘を目立たない側へ降格させません。severity やゲート判定を上書きしてはいけません。
>
> Phase 1 で `scope` を出力するのは JSON 形式（`output.schema.json` が規定する成果物）のみです。YAML / HTML 形式および PR コメントへの反映は Phase 2 で扱います。

## 禁止事項

- 差分に存在しないコードへの推測に基づく指摘
- 一般論だけのレビュー（具体的な差分への言及なし）
- PR の目的と無関係な指摘
- 批判的・攻撃的な口調
