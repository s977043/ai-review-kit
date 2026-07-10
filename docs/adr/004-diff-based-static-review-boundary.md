# ADR-004: diff ベース静的検証の境界—視覚評価・実測系レビューの不採用

## Status

Accepted—#1455 のレビュー観点カバレッジ拡張で、視覚評価・実測系の UI レビュー資産を取り込まないと判断した理由と再参入条件を記録する。

## Context

外部プラグイン（growth-core）のレビュー資産調査（#1455）で、次の3種の UI レビュー機能の取り込みを検討した。

- **視覚評価**: スクリーンショット・Figma URL を入力とするヒューリスティック評価（Nielsen's 10 等）
- **計測ベース比較**: Figma MCP で設計仕様を取得し、Playwright / ブラウザで実装側の computed style を計測して差分を出す方式
- **ドメイン固有の複合ゲート**: LP 公開前チェックのような、UX・パフォーマンス・セキュリティを1回で束ねる独立ゲート

一方、River Review のレビュー実行には次の契約がある。

- レビューエージェントのツールは Read / Grep / Glob / Bash のみ（`agents/river-review.md`）
- GitHub Action ランナー上でも同一の挙動で動作する
- 指摘は差分内のコードにアンカーする（`pages/reference/review-policy.md` §3.1、`.claude/rules/review-core.md`）
- スキルは fixtures / golden で回帰検証できる（`pages/guides/add-new-skill.md`）

視覚評価・計測ベース比較は MCP（Figma / Playwright / ブラウザ）と対話的な実行環境を前提とし、この契約のすべてに反する。スクリーンショットは fixtures として決定論的に検証できず、CI ランナーには計測環境がなく、指摘は差分ではなく描画結果にアンカーされる。

## Decision

視覚評価・計測ベース比較・ドメイン固有複合ゲートは **取り込まない**。River Review の UI/UX レビューは、diff から静的に検出できる範囲に限定する。

- 静的に検出できる UI/UX 観点は既存資産で担う: a11y 系・デザイントークン系・状態設計系の registry skill、および `river-review-code` の UX-SAFEGUARD 参照観点（破壊的操作の安全装置・入力エラーの回復支援）
- 視覚評価・実測は隣接ツール（growth-core の ui-ux-review / figma-design-check 等、MCP を持つ対話的エージェント環境）の責務とし、River Review は結果を競合させない

### 再参入条件

次の両方が成立した時点で、この判断を再検討する。

1. スキルの `inputContext` に視覚資材（例: `designSpec` / `screenshot`）を opt-in 型で追加でき、**入力が提供された場合のみ** Pre-execution Gate を通過する設計が、registry 追加とスキーマ拡張だけで成立する
2. GitHub Action 経路など視覚入力が存在しない実行環境で、当該スキルが安全に `NO_REVIEW` へ退避することを CI で検証できる

## Consequences

- レビュー品質の守備範囲が明確になる: 「デザインどおりに描画されているか」は River Review の保証範囲外であり、利用者は計測系ツールを併用する
- スキル資産はすべて fixtures / golden で回帰検証可能なまま保たれ、GitHub Action 経路との挙動差が生まれない
- 将来 MCP 入力を抽象化する場合も、既存スキル資産を作り直す必要はない（inputContext の拡張で opt-in させる）
