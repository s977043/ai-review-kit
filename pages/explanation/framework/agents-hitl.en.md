---
id: agents-hitl-en
title: Part V—Multi-Agent and HITL
---

## Modular Agent Group

- **CoordinatorAgent**: Tower. Integrates/summarizes specialized agent results. Decides HITL escalation.

- **SecurityAgent**: SAST/SCA, Prompt inspection, Model integrity.

- **PerformanceAgent**: Big-O, Profiling, Load test aggregation.

- **MAIntAInabilityAgent**: Complexity/Style/Naming/Smells.

- **CorrectnessAgent**: Logical correctness / Adversarial test generation.

## HITL Protocol

- Assign **Confidence Score** to all findings

- **Auto-escalation** by threshold/risk

- Humans grasp **Reason / Basis / Uncertainty** at a glance

- **Turn override reasons into training data** -> Reduce false positives, advance domain adaptation
