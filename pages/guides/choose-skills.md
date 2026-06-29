# スキルの選択と組み合わせ

スキルカタログには多くの選択肢があります。このガイドでは、どのスキルを有効にするか、複数のスキルをどう組み合わせるかを判断する基準を説明します。

> **関連ページ**: 全スキルの一覧は [Skills Catalog](../reference/skills-catalog.md) を参照してください。スキルがトリガーされない場合は [スキルルーティングのデバッグ](./debug-skill-routing.md) を参照してください。

## 1. フェーズで候補を絞り込む

スキルは `upstream`・`midstream`・`downstream` のいずれかのフェーズに属しています。レビュー対象の変更がどのフェーズに該当するかを最初に判断することで、候補を大幅に絞り込めます。

- 設計ドキュメント・ADR の変更 → `upstream` スキルを選択する
- アプリケーションコードの変更 → `midstream` スキルを選択する
- テストコード・QA 設定の変更 → `downstream` スキルを選択する

## 2. タグで重複カバレッジを検出する

同じタグを持つスキルは観点の重複が生じる場合もあります。組み合わせる前にタグを確認してください。

| タグの組み合わせ例          | 重複の可能性                                                                                                                                        |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `typescript / type-safety`  | `typescript-nullcheck` と `typescript-strict` は対象グロブが同一。両方有効にすると同一ファイルへの指摘が重複する                                    |
| `community / modern-web`    | `semantic-001`・`performance-001`・`browser-compat-001`・`a11y-interactive-001` の 4 つは対象グロブが同一。最初は目的に合う 1〜2 本を選んで試す     |
| `community / design-system` | `design-token-enforcement-001` と `design-system-component-reuse-001` は異なる軸（トークン vs. コンポーネント）なので、両方有効にしても重複は少ない |

## 3. 重要度で優先順位を決める

複数のスキルが同じファイルにマッチする場合、重要度 (`severity`) の高いスキルを優先して有効にしてください。

- `critical` / `major` → マージブロッカーになりうる。優先して有効にする
- `minor` → 品質改善提案。チームの運用負荷に応じて追加する
- `info` → ポリシー確認のみ。常時有効にしても低コスト

## 4. スタック別の推奨スターターセット

### TypeScript フロントエンド（Next.js / React）

- `typescript-strict` — 型安全の基盤
- `security-basic` — XSS・シークレット漏洩
- `nextjs-app-router-boundary`（Next.js App Router を使う場合）
- `modern-web-a11y-interactive` — インタラクティブ UI のアクセシビリティ
- `design-token-enforcement`（デザインシステムがある場合）

### Python API

- `security-basic`
- `logging-observability`
- `coverage-gap`

### 設計・ドキュメント重視

- `adr-decision-quality`
- `architecture-boundaries`
- `security-privacy-design`

### マルチエージェント・AI レビュー統合

- `independent-review-synthesis` を最後に実行して複数レビュー結果を統合する

## 5. TypeScript の nullcheck vs. strict をどう選ぶか

`typescript-nullcheck` と `typescript-strict` は対象グロブが同一です。

- `strict-001` は `any` 型・unsafe assertion・null ハンドリングを幅広くカバーする
- `nullcheck-001` は null/undefined 安全性に特化してより深くチェックする

`strictNullChecks` が未設定のプロジェクトでは `nullcheck-001` から始め、strict mode が整ったら `strict-001` に移行するか両方有効にすることを推奨します。
