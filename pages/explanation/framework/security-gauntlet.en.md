---
id: security-gauntlet-en
title: Part III—Security Gauntlet
---

Reflecting on risks specific to AI-generated code, we define a **mandatory multi-stage bulletproof vest**.

## Stage 1: Baseline (SAST & SCA)

- OWASP Top 10 pattern detection
- Dependency CVE scan
- Hardcoded secrets detection
- Input data validation and sanitization
- Application of strong encryption algorithms and key management
- Detection of dangerous functions/patterns (SQL string concatenation, eval, etc.)
- Proper authentication and session management
- Detection of missing authorization/access control
- Management of library vulnerabilities (Old versions or known vulns)

## Stage 2: LLM-Specific Vulnerabilities

- **Mimicry of Insecure Patterns**
- **False Confidence** (Verification needed even with high confidence)
- **Prompt Injection** (Review prompt as first-class artifact)

<!-- markdownlint-disable MD060 -->

| Attack Vector        | Mitigation (Example)                               |
| :------------------- | :------------------------------------------------- |
| Instruction Override | Fix priority interpretation in system prompt       |
| Roleplay / DAN       | Prevent jailbreak via output validation            |
| Obfuscation / Typo   | Input normalization / Suspicious pattern detection |
| Template Destruction | Replace with harmless template prompt              |
| Context Poisoning    | Session validation before important items          |
| Logic Manipulation   | Make **HITL** human judgment mandatory             |

<!-- markdownlint-enable MD060 -->

## Stage 3: Supply Chain / Model Integrity

- Training data poisoning, algorithmic/ethical bias
- **Model Due Diligence** (Transparency reports / Security evaluation)
