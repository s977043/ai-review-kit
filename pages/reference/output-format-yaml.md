---
id: output-format-yaml
title: YAML 出力フォーマット (Scoring + Verdict)
description: River Review の YAML 出力形式とスコアリング・判定モデル。
---

River Review は `--output yaml` / `output_format: yaml` で構造化 YAML + 人間向けサマリーを出力する。外部 CI との連携や BI ダッシュボードへの投入に使う。

## CLI

River Review は npm パッケージを公開しません。CLI はリポジトリ内で `npm run river -- ...` として実行します。

```bash
npm run river -- run . --output yaml
```

## GitHub Action

```yaml
- uses: s977043/river-review/runners/github-action@v1.22.0
  with:
    output_format: yaml
```

## 出力例

```yaml
review:
  phase: midstream
  timestamp: '2026-04-18T00:00:00Z'
  verdict: human-review-recommended
  scores:
    overall: 86
    readability: 100
    extensibility: 100
    performance: 80
    security: 100
    maintainability: 90
  derived: true # scores are heuristic, not AI-generated
  high_risk_reasons:
    - security
  summary: '2 findings: 1 major / 1 minor. Overall score 86/100 (human-review-recommended).'
  findings:
    - severity: major
      category: performance
      file: 'src/Repository/OrderRepository.php'
      line: 128
      title: 'N+1 query in loop'
      detail: 'Eager load relations'
      suggestion: 'Use with()'
```

YAML ブロックの後に、人間向けの日本語サマリー（結果/判定/内訳/指摘件数）が付く。出力例（上記 YAML に対応）:

```text
結果: human-review-recommended
判定: overall 86/100 — security ≥95 だが major 指摘が 1 件あるため自動承認不可。
内訳: readability=100 / extensibility=100 / performance=80 / security=100 / maintainability=90
指摘件数: 2 件（major: 1 / minor: 1）
```

### auto-approve の例

overall ≥90 / security ≥95 / critical=0 / major=0 の場合:

```yaml
review:
  phase: midstream
  timestamp: '2026-04-20T09:00:00Z'
  verdict: auto-approve
  scores:
    overall: 97
    readability: 100
    extensibility: 100
    performance: 100
    security: 100
    maintainability: 90
  derived: true
  high_risk_reasons: []
  summary: '1 finding: 1 minor. Overall score 97/100 (auto-approve).'
  findings:
    - severity: minor
      category: readability
      file: 'src/utils/format.ts'
      line: 42
      title: 'Variable name too short'
      detail: '`x` is ambiguous in this context'
      suggestion: 'Rename to `offsetX`'
```

```text
結果: auto-approve
判定: overall 97/100 — 全条件を満たすため自動承認推奨。ただし実マージは人間判断。
内訳: readability=100 / extensibility=100 / performance=100 / security=100 / maintainability=90
指摘件数: 1 件（minor: 1）
```

### human-review-required の例

critical ≥1 または overall &lt;70 の場合:

```yaml
review:
  phase: midstream
  timestamp: '2026-04-20T10:00:00Z'
  verdict: human-review-required
  scores:
    overall: 65
    readability: 90
    extensibility: 80
    performance: 80
    security: 50
    maintainability: 80
  derived: true
  high_risk_reasons:
    - security
  summary: '2 findings: 1 critical / 1 minor. Overall score 65/100 (human-review-required).'
  findings:
    - severity: critical
      category: security
      file: 'src/auth/login.ts'
      line: 87
      title: 'SQL injection risk'
      detail: 'User input concatenated directly into query string'
      suggestion: 'Use parameterized queries'
    - severity: minor
      category: readability
      file: 'src/auth/login.ts'
      line: 12
      title: 'Magic number'
      detail: '`3600` should be a named constant'
      suggestion: 'Extract to `SESSION_TTL_SECONDS`'
```

```text
結果: human-review-required
判定: overall 65/100 — critical 指摘が 1 件あり人間レビュー必須。
内訳: readability=90 / extensibility=80 / performance=80 / security=50 / maintainability=80
指摘件数: 2 件（critical: 1 / minor: 1）
```

## Scoring モデル

### 5 軸

| axis            | 日本語         | 対象領域                           |
| --------------- | -------------- | ---------------------------------- |
| readability     | 可読性         | 命名・構造・明確さ                 |
| extensibility   | 拡張性         | アーキテクチャ・依存方向・責務分離 |
| performance     | パフォーマンス | N+1・ループ内 I/O・クエリ効率      |
| security        | セキュリティ   | 入力検証・認証認可・機密情報保護   |
| maintainability | 保守性         | テスト品質・パターン準拠           |

### axis 分類ルール

finding の `ruleId` prefix で axis を決定。patterns は `src/lib/scoring/rubric.mjs` の `AXIS_PATTERNS` を参照。

| パターン                                      | axis                       |
| --------------------------------------------- | -------------------------- |
| `rr-*-sec-*`, `*-security-*`, `*-auth-*`      | security                   |
| `rr-*-perf-*`, `*-n-plus-one-*`, `*-query-*`  | performance                |
| `rr-*-arch-*`, `*-depend-*`, `*-layer-*`      | extensibility              |
| `rr-*-read-*`, `*-naming-*`, `*-complexity-*` | readability                |
| `rr-*-test-*`, `*-coverage-*`                 | maintainability            |
| （上記以外）                                  | maintainability (fallback) |

### 減点表

axis 100 点満点で、finding の severity ごとに減点する。

| severity | security | その他 axis |
| -------- | -------- | ----------- |
| critical | -50      | -30         |
| major    | -30      | -20         |
| minor    | -15      | -10         |
| info     | -5       | -3          |

overall は 5 axis の平均値。

## Verdict（判定）

| verdict                    | 条件                                                    | 意味                                                          |
| -------------------------- | ------------------------------------------------------- | ------------------------------------------------------------- |
| `auto-approve`             | overall ≥90 AND security ≥95 AND critical=0 AND major=0 | 自動承認 **推奨**。ただし HITL 方針のため実マージは人間判断。 |
| `human-review-recommended` | 上記に該当しない AND critical=0 AND overall ≥70         | 人間レビュー推奨。                                            |
| `human-review-required`    | critical ≥1 OR overall &lt;70                           | 人間レビュー必須。                                            |

## 重要な注意事項

- **`derived: true` フラグ**: score は決定論的に算出された**参考値**であり、LLM による質的判断ではない。単独でマージ可否を判断しない。
- **`auto-approve` は HITL を上書きしない**: policy レベルで river-review は人間レビューを前提とする。`auto-approve` verdict は自動化ツールへの情報提供であって、merge 権限を委譲するものではない。
- **rubric のカスタマイズ**: 現行は `src/lib/scoring/rubric.mjs` 固定。プロジェクト別のチューニングは将来 `config/scoring-rubric.json` で外部化予定。

## 関連

- `src/lib/scoring/engine.mjs` — スコアリング実装
- `src/lib/scoring/rubric.mjs` — axis 分類パターン・減点表
- `src/lib/output-formatters/yaml.mjs` — YAML 出力生成
- `schemas/review-artifact.schema.json` — 内部 schema (v1、本出力と互換)
