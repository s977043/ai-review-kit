---
id: rr-midstream-hello-skill-001
name: Hello Skill (Always-On Sample)
description: Minimal always-on sample skill to guarantee an end-to-end review experience.
phase: midstream
applyTo:
  - '**/*'
tags: [sample, hello, midstream]
severity: info
inputContext: [diff]
outputKind: [findings, summary]
modelHint: cheap
---

このスキルは「最小構成でも必ず 1 つスキルが選ばれる」ことを目的としたサンプルです。

- 変更差分が存在する限り、ほぼ全てのリポジトリで選択されます（`applyTo: '**/*'`）。
- 実運用では、より具体的な `applyTo` と `inputContext` を設定し、指摘の粒度を上げてください。

## 評価指標（Evaluation）

- 合格基準: 指摘が差分に紐づき、根拠と次アクションが説明されている。
- 不合格基準: 差分と無関係な指摘、根拠のない断定、抑制条件の無視。

## 人間に返す条件（Human Handoff）

- 仕様や意図が不明確で解釈が分かれる場合は質問として返す。
- 影響範囲が広い設計判断やトレードオフは人間レビューへ返す。
