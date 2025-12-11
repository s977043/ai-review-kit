---
# Required metadata (validate with schemas/skill.schema.json)
id: rr-<phase>-<category>-<number> # 例: rr-midstream-code-quality-001（フェーズ-カテゴリ-連番）
name: <Human readable title> # 50文字以内で簡潔に
description: <What this skill checks> # 具体的なチェック目的
phase: upstream # upstream | midstream | downstream
applyTo:
  - 'src/**/*.ts' # glob パターンを列挙。できるだけ絞り込む
tags:
  - example # カテゴリやドメインタグ（security, testing, api 等）
severity: minor # info | minor | major | critical
inputContext:
  - diff # diff / fullFile / tests / adr / repoConfig など
outputKind:
  - findings # findings / summary / actions / tests / metrics / questions
dependencies:
  - code_search # 必要なリソースがあれば指定。不要なら省略
---

## Rule / ルール (テンプレート)

レビュー対象のルールを明確に書きます。例: 「モジュールは単一責任を保つ」「危険なデフォルトエクスポートを避ける」。

## Rationale / 背景 (テンプレート)

なぜこのルールが重要かを説明します。設計原則や品質基準へのリンクがあれば記載します。

## Heuristics / 判定の手がかり (テンプレート)

違反を検知するための手がかりを箇条書きで示します（キーワード、構造、依存関係など）。

## Good / Bad Examples (テンプレート)

短いコード例で良い例・悪い例を示し、何が問題か・どう改善するかを示します。

---

# 完成例

## Upstream: ADR 整合性チェック

---

id: rr-upstream-adr-consistency-001
name: ADR Consistency Check
description: ADR の決定事項が設計ドキュメントやコードと整合しているかを確認する
phase: upstream
applyTo:

- 'docs/adr/\*_/_.md'
- 'docs/architecture/\*_/_.md'
  tags: [adr, architecture, upstream]
  severity: major
  inputContext: [diff, adr]
  outputKind: [findings, summary]

---

## Rule / ルール (Upstream ADR)

- 変更された設計/ADR に矛盾や未更新の決定事項がないか確認する
- 重大な決定事項には影響範囲とトレードオフが明記されていること

## Heuristics (Upstream ADR)

- ADR で採用/却下した選択肢がコードや設計に反映されていない
- 影響範囲やリスクが空欄・未記載
- 日付やバージョンが更新されていない

## Good / Bad Examples (Upstream ADR)

- Good: 採用理由、トレードオフ、影響範囲が列挙されている
- Bad: 「採用」だけ記載し、理由や影響範囲が不明

---

## Midstream: コード品質チェック

---

id: rr-midstream-code-quality-advanced-001
name: Code Quality Baseline
description: 可読性と保守性を低下させる典型的なコードパターンを検出する
phase: midstream
applyTo:

- 'src/\*_/_.ts'
- 'src/\*_/_.tsx'
  tags: [code-quality, readability, midstream]
  severity: major
  inputContext: [diff, fullFile]
  outputKind: [findings, actions]
  dependencies: [code_search]

---

## Rule / ルール (Midstream Code Quality)

- 複雑度が高い関数や重複コードを減らす
- 不必要な any/型アサーションを避け、型安全性を確保する
- 命名・責務が曖昧なクラス/コンポーネントを明確化する

## Heuristics (Midstream Code Quality)

- 200 行以上のコンポーネント、深いネスト、循環参照
- any / as による型抜け、null チェック不足
- 一度だけ使用されるユーティリティや無名の副作用

## Good / Bad Examples (Midstream Code Quality)

- Good: 明確な Props/State 型、SRP に沿ったコンポーネント分割
- Bad: any 多用、巨大コンポーネント、重複したロジック

---

## Downstream: テストカバレッジ / 命名

---

id: rr-downstream-test-quality-001
name: Test Coverage and Naming
description: テストのカバレッジと命名規約が守られているかを確認する
phase: downstream
applyTo:

- '\*_/_.test.ts'
- '\*_/_.spec.ts'
  tags: [tests, coverage, naming, downstream]
  severity: minor
  inputContext: [tests, diff]
  outputKind: [tests, findings, summary]

---

## Rule / ルール (Downstream Test Quality)

- 主要なユースケース・失敗パスをテストでカバーする
- describe/it の命名を一貫させ、何を期待するか明示する

## Heuristics (Downstream Test Quality)

- it 名が曖昧（"should work" 等）で期待値が不明
- 例外や境界ケースのテスト不足
- テストデータが共有化されず重複している

## Good / Bad Examples (Downstream Test Quality)

- Good: `it('returns 422 when payload is invalid')`
- Bad: `it('works')`
