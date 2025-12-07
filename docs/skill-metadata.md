# スキルメタデータ仕様（Issue #68 設計）

River Reviewer のスキルは YAML フロントマターでメタデータを持ち、ローダー/ランナーがそれを元に選択・実行します。本仕様は、JSON Schema と TypeScript 型、ランナー実装の土台となるフィールド定義をまとめたものです。

## 1. 目的

- スキル選択・ルーティングをメタデータだけで機械的に行えるようにする。
- JSON Schema / TypeScript 型を実装する際の「真実の源泉」として参照できるようにする。
- ランナー・ローダーが将来拡張（モデル選択、依存ツール呼び出しなど）しやすい粒度で設計する。

## 2. 現状の基本項目（skills/* を棚卸し）

現在のスキルで使われているキーと役割は以下のとおり。

| Field | Type | Required | 役割 |
| --- | --- | --- | --- |
| `id` | string | yes | スキルの一意な ID（`rr-<phase>-<slug>-###` 推奨）。リネームや移動でも不変。 |
| `name` | string | yes | レビュー出力などに表示する人間向け名称。 |
| `description` | string | yes | スキルが何をチェックするかの短い説明。 |
| `phase` | enum (`upstream` \| `midstream` \| `downstream`) | yes | SDLC のどの流れで適用するか。ルーティングの主要キー。 |
| `applyTo` | string[] | yes | チェック対象ファイルの glob。ランナーが対象ファイルを絞り込むために使用。 |
| `tags` | string[] | optional | スキルの分類タグ（例: `security`, `performance`）。 |
| `severity` | enum (`info` \| `minor` \| `major` \| `critical`) | optional | 重大度。出力の強調や並び替えに利用。 |

## 3. 拡張項目（今回設計）

将来のモデル選択や入力準備を見据えて、無理なく実装できる粒度の項目を定義する。

| Field | Type | Required | 目的・ユースケース | 許容値の例 |
| --- | --- | --- | --- | --- |
| `inputContext` | enum string[] | optional | スキルが前提とする入力ソース。ランナーが必要なコンテキストを用意し、揃わない場合にスキップする判断材料に使う。 | `diff`, `fullFile`, `tests`, `adr`, `commitMessage`, `repoConfig` |
| `outputKind` | enum string[] | optional (default: `["findings"]`) | スキルが返す主な出力カテゴリ。UI での整列・集約や後段処理の分岐に利用。複数指定で兼用も可能。 | `findings`, `summary`, `actions`, `tests`, `metrics`, `questions` |
| `modelHint` | enum string | optional | モデル選択のコスト/精度指針。ランナーが上限トークンやコスト制約に合わせてモデルを選ぶ際のヒントにする。 | `cheap`, `balanced`, `high-accuracy` |
| `dependencies` | enum string[] | optional | スキルが依存するツール/リソース。実行前に満たせない場合はスキップやデグレードを判断する。 | `code_search`, `test_runner`, `adr_lookup`, `repo_metadata`, `coverage_report`, `tracing` |

`outputKind` の各値（解釈の揺れを防ぐための目安）:

- `findings`: コードの指摘・改善点（デフォルト）
- `summary`: レビュー全体の要約
- `actions`: 実装者が取るべき具体的な行動やコマンド
- `questions`: 実装者への確認事項や未解決の問い
- `metrics`: 複雑度・カバレッジなどの計測値
- `tests`: 生成したテストやテストケース提案

補足:

- enum は実装時に固定リスト化する前提。列挙にない値を許可する必要が生じた場合は `custom:<name>` のような prefix で拡張する運用を想定。
- 依存ツールは runner/loader 側で実装可否が明確な単位（コード検索・テスト実行・ADR 検索など）にとどめる。

## 4. TypeScript インタフェース例

実装時にそのまま利用できる形の例。

```ts
type Phase = 'upstream' | 'midstream' | 'downstream';
type Severity = 'info' | 'minor' | 'major' | 'critical';

type InputContext =
  | 'diff'
  | 'fullFile'
  | 'tests'
  | 'adr'
  | 'commitMessage'
  | 'repoConfig';

type OutputKind =
  | 'findings'
  | 'summary'
  | 'actions'
  | 'tests'
  | 'metrics'
  | 'questions';

type ModelHint = 'cheap' | 'balanced' | 'high-accuracy';

type Dependency =
  | 'code_search'
  | 'test_runner'
  | 'adr_lookup'
  | 'repo_metadata'
  | 'coverage_report'
  | 'tracing';

export interface SkillMetadata {
  id: string;
  name: string;
  description: string;
  phase: Phase;
  applyTo: string[];
  tags?: string[];
  severity?: Severity;
  inputContext?: InputContext[];
  outputKind?: OutputKind[]; // default ['findings']
  modelHint?: ModelHint;
  dependencies?: Dependency[];
}
```

## 5. JSON Schema 実装メモ

- `phase` と `severity` は既存どおり enum 固定。
- `inputContext` は `type: array`, `items.enum` を上記リストで固定、`minItems: 1`, `uniqueItems: true` を推奨。
- `outputKind` も同様に array + enum + `minItems: 1`。フィールド自体を省略した場合のみランナー側で `['findings']` をデフォルトとし、フィールドが存在する場合は空配列を許可しない。
- `modelHint` は単一 enum。必須にはしない。
- `dependencies` は array + enum + `uniqueItems: true`。未実装ツールを防ぐため列挙外は許可しない運用を基本とし、例外は `custom:*` を許容する場合のみ `pattern` を追加する。
- `additionalProperties: false` を維持してスキーマドリフトを防止。

## 6. サンプル frontmatter（Before/After）

### Before（現行フィールドのみ）

```yaml
---
id: rr-midstream-code-quality-sample-001
name: 'Sample Code Quality Pass'
description: 'Checks common code quality and maintainability risks.'
phase: midstream
applyTo:
  - 'src/**/*.ts'
  - 'src/**/*.js'
  - 'src/**/*.py'
tags:
  - style
  - maintainability
  - midstream
severity: 'minor'
---
```

### After（拡張フィールドを追加）

```yaml
---
id: rr-midstream-code-quality-sample-001
name: 'Sample Code Quality Pass'
description: 'Checks common code quality and maintainability risks.'
phase: midstream
applyTo:
  - 'src/**/*.ts'
  - 'src/**/*.js'
  - 'src/**/*.py'
tags:
  - style
  - maintainability
  - midstream
severity: 'minor'
inputContext:
  - diff
  - fullFile
outputKind:
  - findings
  - actions
modelHint: balanced
dependencies:
  - code_search
---
```

## 7. 実装者向けメモ

- ランナーは `phase` と `applyTo` に加え、`inputContext` が満たせないスキルは事前にスキップできるようにする（例: ADR 未取得時に `adr` を要求するスキルを除外）。
- `outputKind` を使って UI/出力整形を分ける（例: `summary` は上部、`actions` は ToDo として並べる）。
- `modelHint` はフェーズやコスト上限と組み合わせてモデル選択する。最初は 3 段階の enum だけで十分。
- `dependencies` は runner/loader が提供できるツールのチェックリストと突き合わせ、未対応なら graceful skip か fallback を選択する。
- enum の粒度を増やしたくなった場合は実装前に合意する（特に `outputKind` と `dependencies`）。
