# River Reviewer アーキテクチャ（Planner 連携版）

## 目的

- Skill Planner 導入後の全体像（metadata → loader → planner → runner）を共有する。
- LLM を使った優先度決定と、フォールバック経路を明示する。
- 今後の最適化タスク（#85 以降）のベースドキュメントとする。

## コンポーネント一覧

- Skill Metadata: `skills/**/*.md` の frontmatter（`docs/skill-metadata.md` が仕様源）。
- Skill Loader: frontmatter を schema で検証し、`SkillDefinition` を構築。
- Skill Planner: LLM または関数でスキル順序を推論（`src/lib/skill-planner.mjs`）。
- Review Runner: スキル選択と実行のオーケストレーション（`src/lib/review-runner.mjs`）。

## 処理フロー

```mermaid
flowchart LR
  A[skills/**/*.md\n(frontmatter)] --> B[Skill Loader\nschema validate]
  B --> C{Filter\nphase/applyTo\ninputContext}
  C -->|ok| D[候補スキル]
  C -->|skip理由| S[Skipped list]
  D -->|plannerあり| P[Skill Planner\nLLM / function]
  D -->|plannerなし| R[rankByModelHint\n決定論的順位付け]
  P -->|順序と理由| O[Ordered skills]
  P -->|例外| R
  R --> O
  O --> X[Review Runner\n実行]
```

## Skill Planner の入出力

- 入力: `llmPlan({ skills, context })`
  - `skills`: `summarizeSkill` 済みメタデータ（id/name/description/phase/applyTo/inputContext/outputKind/modelHint/dependencies/tags/severity）
  - `context`: `phase`, `changedFiles`, `availableContexts`（必要なら diff 要約や PR 情報を拡張可）
- 出力: `[{ id, reason? }]`（配列順が実行順。`priority` は現状未使用）
- フォールバック:
  - planner 未指定 → `rankByModelHint` による決定論的順序
  - planner 内で例外発生 → 決定論的順序に切り替え、理由を `plannerReasons` に残す
- サンプルコード: `docs/skill-planner.md` にミニマム実装例あり。

## Review Runner の動作概要

1. Skill Loader から全スキルを取得。
2. `phase` / `applyTo` / `inputContext` でフィルタし、`selected` と `skipped` を生成。
3. planner があれば `planSkills` を呼び出し、なければ `rankByModelHint`。
4. 結果を `selected`（実行順序付き）と `skipped`（理由付き）として返却。
5. Planner 失敗時は決定論的経路に自動フォールバック。

## 代表スキルとの関係

- 例: `skills/midstream/sample-code-quality.md`
  - `phase: midstream`
  - `applyTo: ["src/**/*.ts", "src/**/*.js", "src/**/*.py"]`
  - `inputContext: ["diff"]`
  - `modelHint: balanced`
- Planner は `summarizeSkill` で整形されたメタデータを受け取り、LLM が選択順序や理由を返す。`applyTo`/`inputContext` で事前に絞り込み済みなので、LLM は「どれを優先するか」に集中できる。

## 参考ドキュメント

- `docs/skill-metadata.md`（メタデ仕様の真実の源泉）
- `docs/skill-planner.md`（LLM 接続例と I/O 契約）
- `src/lib/skill-loader.mjs` / `src/lib/review-runner.mjs` / `src/lib/skill-planner.mjs`
