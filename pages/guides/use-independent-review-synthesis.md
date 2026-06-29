# Independent Review Synthesis を使う

複数の AI / 人間レビュー結果を統合し、merge 判断を支援するための skill。
Nolan Lawson 氏の Triple Agent skill にインスパイアされつつ、ツール固定を避け、
River Review の artifact-driven 思想に合わせて再構成した「synthesis pattern」。

- 該当 skill: `independent-review-synthesis`
- 関連 epic: [#911](https://github.com/s977043/river-review/issues/911)
- ステータス: Phase 1 (community / `recommended: false`)。Phase 2 で artifact contract 拡張、Phase 3 で CLI ensemble mode を予定。

## いつ使うか

- **複数の AI レビュー結果を集約したい**（例: Claude / Codex / Cursor / GitHub Copilot のレビューを並走させ、出力を 1 つにまとめる）
- **AI レビューと人間レビューを併用したい**（review-external に AI 結果、review-self に著者のセルフレビューを置く）
- **過去 PR の findings を踏まえて判断したい**（findings-pool に履歴を渡す）

## いつ使わないか

- 単一 reviewer しかいない一般的な PR レビュー → 既存の midstream skill 群で十分
- 新しいレビュー観点（security / a11y / performance）を追加したい → 個別 skill を作る
- レビュー結果の多数決で merge 判断を自動化したい → この skill は多数決を採用しない。Hard rule 1。

## 入力

`.river/` などのリポジトリ規約に従い、以下の artifact を渡す:

| artifact ID       | 形式         | 役割                                                  |
| ----------------- | ------------ | ----------------------------------------------------- |
| `diff`            | patch / diff | 必須。当該 PR の差分                                  |
| `review-self`     | Markdown     | 任意。実装者のセルフレビュー                          |
| `review-external` | Markdown     | 任意。外部 AI / 人間レビュー                          |
| `findings-pool`   | JSON         | 任意。過去 Review Artifact から集約した findings 履歴 |
| `fullFile`        | source       | 任意。verification step での精度を上げる              |

artifact 定義の詳細は [`pages/reference/artifact-input-contract.md`](../reference/artifact-input-contract.md) 参照。

## 出力

6 セクション固定:

1. Critical Issues
2. Major Issues
3. Minor Issues
4. Dismissed Findings (hallucination / duplicate)
5. Agent Agreement Summary (どの reviewer が何を指摘したかの一覧、補助情報)
6. Merge Recommendation (`merge-ready` / `human-review` / `block`)

各 finding は `Finding:` / `Evidence:` / `Reviewers:` / `Severity:` / `ValidatedStatus:` / `Suggestion:` のブロック形式。

## 設計原則

- **多数決禁止**: `Reviewers:` は補助情報。`Severity` / `ValidatedStatus` は evidence 品質で決める
- **Hallucination guard**: 各 finding の `Evidence:` が実コードに存在するか grep で確認。見つからなければ `dismissed-hallucination`
- **Single-reviewer findings は採用可**: 1 reviewer のみの指摘でも、evidence があれば confirmed
- **Evidence なしの critical は不可**: severity の上限は `major`
- **Provider 固定禁止**: skill body に Claude / Codex / Cursor の名前を書かない

## ローカル評価

`promptfoo eval` で動作確認:

```bash
cd skills/midstream/community/independent-review-synthesis/eval
promptfoo eval
```

`OPENAI_API_KEY` / `ANTHROPIC_API_KEY` が必要。Phase 1 では `golden/` は空のまま (hand-written goldens は本リポジトリの「posture, not progress」アンチパターンに該当)。実 LLM run で生成した出力を保存して promotion path に進む。

## Phase 1 の限界

- artifact contract は既存の `review-self` / `review-external` / `findings-pool` をそのまま使う
- `findings[]` への provenance フィールド (`reviewer`, `agreement[]`, `validatedStatus`) は Phase 2 で schema 拡張
- CLI ショートカット (`--ensemble claude,codex,cursor` 等) は Phase 3
- 現状は **skill body + fixtures + eval scaffolding** のみ
