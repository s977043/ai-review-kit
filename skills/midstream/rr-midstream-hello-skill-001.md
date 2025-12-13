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
