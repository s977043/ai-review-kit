---
id: agents-hitl
title: Part V — マルチエージェントとHITL
---

### モジュラーなエージェント群

- **CoordinatorAgent**: 台抜。専門エージェントの結果を統合し要約。HITLのエスカレーション判断。

- **SecurityAgent**: SAST/SCA、プロンプト検査、モデル完全性。

- **PerformanceAgent**: Big-O、プロファイル、負荷試験の集計。

- **MaintainabilityAgent**: 複雑度/スタイル/命名/スメル。

- **CorrectnessAgent**: 論理正しさ・敵対的テスト生成。

### HITLプロトコル

- **信頼度スコア**を全指摘に付与

- しきい値/リスクで**自動エスカレーション**

- 人間は**理由・格振・不確実性**を一直で把握

- **オーバーライド理由を学習データ化** → 偽陳陽性を減らしドメイン適合が進む
