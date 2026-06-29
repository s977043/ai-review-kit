---
id: 'refactor-claim-audit'
name: 'Refactor-Claim Audit リファクタ完了主張の検証'
description: 'コミット/PR の「全部置換した」「-N%削減」等の完了主張を、grep で反証できる残骸や best/typical/worst 試算で検証する'
version: 0.1.0
category: midstream
phase: midstream
applyTo:
  - '**/*.{ts,tsx,js,jsx,mjs}'
  - '**/*.md'
  - '**/*.{yaml,yml,json}'
tags: [adversarial, refactor-claim, claim-vs-actual, verification, midstream, cognitive-bias]
severity: major
inputContext: [diff, fullFile]
outputKind: [findings, actions]
modelHint: high-accuracy
dependencies: [code_search]
---

## Pattern declaration

Primary pattern: Reviewer
Secondary patterns: Inversion
Why: 完了主張の反証は grep 検索による決定論的突合が主だが、主張がない変更では実行を止めるゲートが必要

## Goal / 目的

- 「全部置換した」「すべて移行済み」「-83% 削減」のような **完了主張**（commit message / PR description / コメント）に対し、grep で簡単に反証できる残骸や、過大な数値主張を検証する。
- 「やったと書いてあること」と「実際にやれていること」のギャップを可視化する。

## Non-goals / 扱わないこと

- リファクタの設計妥当性の判断（それ自体が良い変更かは問わない）。
- 残骸が1件もない正当な完了主張への難癖（反証できなければ指摘しない）。
- パフォーマンス計測の代替（数値は主張の論理的整合性のみ検証し、実測はしない）。

## Pre-execution Gate / 実行前ゲート

このスキルは以下の条件がすべて満たされない限り `NO_REVIEW` を返す。

- [ ] 差分・commit message・PR description に完了主張（「全」「すべて」「all」「完了」「移行済」「置換」「-N%」「削減」等）が含まれている
- [ ] inputContext に diff が含まれている

ゲート不成立時の出力: `NO_REVIEW: refactor-claim-audit — 完了主張が検出されない`

## False-positive guards / 抑制条件

- 主張の対象を grep しても残骸が見つからない場合は指摘しない（反証できない主張は正しいとみなす）。
- 残骸が意図的に残されたもの（後方互換のための alias、deprecation 期間中の旧 API 等）で、差分内にその旨が明記されている場合は抑制。
- 数値主張が範囲表記（「-47%〜-55%」）で既に幅を持っている場合は抑制。

## Rule / ルール

### 検出ロジック

1. **主張の抽出**: 完了主張を抽出し、検証可能な命題に変換する。
   - 置換主張: 「A を B に全置換」→ 「repo 全体に A が残っていないはず」
   - 完了主張: 「移行完了」→ 「旧構造への参照が残っていないはず」
   - 数値主張: 「-N%」→ 「best/typical/worst のどのケースの値か」
2. **反証検索**: 主張の対象パターン（旧 API 名・旧参照形式・旧記法）を repo 全体に grep し、残骸を探す。
3. **数値の独立試算**: `-N%` 等の定量主張は、best-case / typical-case / worst-case を独立に算出し、主張値がどのケースか・過大表示でないかを併記要求する。
4. **ギャップの報告**: 主張と、それを反証する残骸 or 試算を `<file>:<line>` で示す。

### 制約

- 検出は最大 5 件。反証が明確で影響が大きいものを優先。
- 各指摘には「主張」「主張の出典」「反証（残骸位置 or 試算）」を必ず含める。
- 残骸を挙げるときは grep で再現可能な検索語を明示する。

## Evidence / 根拠の取り方

- 反証する残骸は必ず `<file>:<line>` と検索語を示し、推測しない。
- 数値主張は算出根拠（分母・分子・ケース定義）を明示し、best/typical/worst を区別する。

## Output / 出力フォーマット

すべて日本語。

```text
(refactor-claim-audit):1: [要約] 最も過大な完了主張は〈1文〉

<file>:<line>: [完了主張の反証1] <タイトル>
  主張: 「<完了主張の引用>」(<出典: commit message | PR | file:line>)
  反証: <残骸の説明 or 試算>(検索語: `<grep pattern>`, <file>:<line>)
  実態: <主張と実態のギャップ>
  Fix: <残骸を処理するか、主張を実態に合わせて訂正する>

<file>:<line>: [完了主張の反証2] ...
```

## Good / Bad Examples

### Good

```text
sub-supervisor.md:1: [完了主張の反証] 「章番号参照を全置換」主張に対し本文7箇所が未置換
  主張: 「sub-supervisor の章番号参照 → ファイル参照に置換」(commit message)
  反証: 冒頭の参照表のみ置換、本文は §refs のまま (検索語: `§[0-9]`, sub-supervisor.md:38,68,85,87,111,123)
  実態: 7 箇所が未置換で「全置換」は不成立
  Fix: 本文 7 箇所を置換するか、commit message を「参照表のみ置換」に訂正
```

### Bad

```text
リファクタが不完全そうです
```

（主張の引用なし、残骸位置・検索語なし、具体性なし）

## 評価指標（Evaluation）

- 合格基準: 完了主張が引用され、反証が grep 再現可能な検索語 + `<file>:<line>`、または明示された試算で示されている。
- 不合格基準: 主張の引用がない、残骸を grep で再現できない、数値試算の根拠がない、反証できないのに指摘している。

## 人間に返す条件（Human Handoff）

- 残骸を処理するか主張を訂正するかが、後方互換や移行戦略の判断を要する場合。
- 数値主張の正しいケース定義（何を分母にするか）がチーム合意を要する場合。
