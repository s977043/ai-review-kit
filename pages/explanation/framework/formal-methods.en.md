---
id: formal-methods-en
title: Part IV—Formal Methods and Quantitative Analysis
---

## Application of Formal Methods

- Generate **Formal Specs (TLA+/Alloy etc.)** from natural language requirements

- Verify if generated code meets specs via **Symbolic Execution / Model Checking / Proof Assistants**

## Effectiveness Metrics (Avoid Vanity)

<!-- markdownlint-disable MD060 -->

| Category | Metrics                                     | Purpose                                                     |
| :------- | :------------------------------------------ | :---------------------------------------------------------- |
| Quality  | **Defect Rate Post-Review**                 | Most important outcome                                      |
| Quality  | Critical Issue Detection Rate               | Grasp severity of security/performance                      |
| Quality  | **Code Churn**                              | Diagnose requirement/review quality via short-term fix rate |
| Velocity | **Review Cycle Time**                       | Visualize bottlenecks                                       |
| Velocity | Time to First Review                        | Responsiveness                                              |
| Process  | False Negative/Positive Rate, Override Rate | Learning indicator for AI adaptability                      |

<!-- markdownlint-enable MD060 -->

> Dashboard output collected in CI -> Schematized in `reference/` enhances reproducibility.
