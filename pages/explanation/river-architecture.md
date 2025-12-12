# River Reviewer のアーキテクチャ

River Reviewer は、変更の流れに沿って「上流 → 中流 → 下流」の観点でレビューを組み立てます。

- **上流（upstream）**: 要件、設計、ADR、脅威モデル、制約
- **中流（midstream）**: 実装、リファクタ、CI 組み込み、品質
- **下流（downstream）**: テスト、リリース、運用、失敗パス検知

加えて、**Riverbed Memory** は意思決定や前提（ルール）を保持し、レビューの一貫性を高めるための層です。

## コンポーネント

```mermaid
flowchart LR
  Diff[Git diff / PR diff] --> Optimizer[Diff optimizer]
  Optimizer --> Loader[Skill loader]
  Loader --> Filter{phase/applyTo\ninputContext/dependencies}
  Filter -->|selected| Planner[Skill planner\n(optional)]
  Filter -->|skipped + reasons| Skipped[Skipped list]
  Planner --> Runner[Review runner]
  Runner --> Output[Output schema\nissues[] + summary]
```

## 代表フロー（GitHub Actions）

```mermaid
sequenceDiagram
  participant GH as GitHub Actions
  participant Repo as Repository
  participant River as river-reviewer (action/cli)
  participant LLM as LLM API

  GH->>Repo: checkout (fetch-depth: 0)
  GH->>River: run (phase=midstream)
  River->>Repo: compute merge-base / diff
  River->>River: select skills (selected/skipped)
  alt dry-run / missing API key
    River->>River: fallback comments
  else LLM enabled
    River->>LLM: prompt (skills + context)
    LLM-->>River: review output
  end
  River-->>GH: comments / summary
```

## 代表フロー（ローカル）

```mermaid
sequenceDiagram
  participant Dev as Developer
  participant River as river (CLI)
  participant Repo as Local repo

  Dev->>River: river run . (--debug/--dry-run)
  River->>Repo: diff/merge-base
  River->>River: select skills (selected/skipped)
  River-->>Dev: plan + comments (+ debug)
```
