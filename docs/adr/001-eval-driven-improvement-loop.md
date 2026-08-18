# ADR-001: Evaluation-Driven Reviewer Improvement Loop を導入する

## Status

Accepted

## Context

River Review は phase-aware な review framework として、Upstream / Midstream / Downstream の流れ、schema-driven な skill 管理、evidence-based なフィードバックを重視している。現在の repo には planner:eval、eval:fixtures、agent-skills:validate、Agent Skills runtime loading、SKILL.md bridge、routing skills、review severity gate evaluator、meta-consistency validation が存在し、改善のための構成要素は揃っている。

一方で、改善の採否を一貫して記録し、baseline と比較し、keep/discard を判断する統一ループはまだ前面化されていない。[autoagent](https://github.com/kevinrgu/autoagent) は baseline-first、ledger、failure grouping、specialized tools、verification sub-agent、keep/discard rule を明示しており、この運用原理は River Review の改善プロセスに転用できる。

## Decision

River Review に、production runtime の自己改変ではなく、review framework 自体の改善運用としての Evaluation-Driven Improvement Loop を導入する。

導入範囲:

1. planner:eval / eval:fixtures / severity / meta-consistency を束ねる統合 eval runner（`npm run eval:all`）
2. 実験 ledger（`artifacts/evals/results.jsonl`）
3. failure taxonomy（eval 結果の構造化分類）
4. reviewer → verifier の二段構成
5. Riverbed Memory v1 への接続点となる artifact 出力

## Non-Goals

- production reviewer の自律自己改変
- single-file harness 化
- passed だけを最適化する単一指標運用
- phase / schema / evidence-based 原則の弱体化

## Consequences

### Positive

- 改善の採否が説明可能になる
- false positive と evidence 欠落を系統的に減らせる
- Riverbed Memory v1 に接続しやすくなる
- skill 改善と tool 改善を分けて議論できる

### Negative

- eval 運用コストが増える
- fixture 整備が先に要る
- 指標設計を誤ると局所最適化が起きる

## Rollout Plan

1. 統合 eval runner + ledger（PR-1: merged）
2. 構造化 eval 結果 + multi-axis metrics（PR-2）
3. keep/discard policy（PR-3: this document）
4. failure taxonomy（PR-4）
5. verifier layer（PR-5）
6. reviewer-specific tools（PR-6+）
7. Riverbed Memory v1（PR-9-10）
