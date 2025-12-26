# Code Review Perspectives (Conceptual - Shared by AI/Human)

> This checklist is for aligning perspectives.
> Define specific rules for each project [This document aims for a "consistent least common multiple"].

## 0. Quick Check (First Look)

- [ ] Purpose can be stated in one sentence (Conveyed by PR title/summary).
- [ ] Changes are **small and focused** (No unrelated diffs).
- [ ] Tests or operation evidence exist, and reproduction steps are **concise** (Easy for AI/human to verify).

## 1. Readability

- [ ] Roles and granularity are clear from names alone (Functions start with verbs, avoid abbreviations).
- [ ] Comments explain **why** (Background/premises/choices), not just **what** (Verbatim implementation).
- [ ] One responsibility per function. Not long (Aim for roughly one screen height).
- [ ] "Input -> Process -> Output" of specs is traceable.

## 2. Precision

- [ ] Comparisons are explicit including types (e.g., `===` / `??` / `?.` are appropriately applied).
- [ ] Handling of undefined/empty/NaN/boundaries is not ambiguous.
- [ ] No magic numbers/units/ranges (Provide basis or use constants).

## 3. Diff Hygiene

- [ ] Diffs passed through formatter/linter (No noise).
- [ ] No **meaningless diffs** like naming/reordering mixed in.

## 4. Naming & Data

- [ ] Variables/functions have predictable uses (Types can be inferred if needed).
- [ ] Use constants (OAOO: Once and Only Once). No magic numbers.
- [ ] Responsibilities and boundaries of data structures are clear (No mixing of DTO/Domain/UI).

## 5. Design

- [ ] Prefer **composition**; minimize inheritance.
- [ ] Suppress direct external access (Explicitly use getters/APIs).
- [ ] Reference order is readable ("Referenced -> Referencing").

## 6. Control Flow

- [ ] Blocks `{}` should generally not be omitted (Except for single lines; avoid line breaks).
- [ ] Loops/branches use syntax matching intent (`for…of/in`, high-order functions for functional).
- [ ] `switch` fall-through is **explicitly intended**.

## 7. Error Handling

- [ ] Capture only expected logical errors (No silencing).
- [ ] Exception propagation policy is consistent (Predictable for callers).
- [ ] Logs/messages are sufficient for root cause analysis.

## 8. Readability vs Performance

- [ ] Optimizations that significantly impair readability are **rare exceptions** (With basis).
- [ ] Comment optimized areas: `// performance optimized: <reason/premise/measurement>`.

## 9. Change Unit

- [ ] 1 PR = 1 Purpose (Separate formatting/renaming from functional changes).
- [ ] PR body has **Purpose, Changes, Impact Scope, and Verification Method**.

## 10. AI/Agent-Ready

- [ ] **Deterministic** reproduction: No interaction needed, verifiable with 1-2 commands.
- [ ] External dependencies are explicitly stated (Env vars, services, permissions, seeds).
- [ ] Inputs/Outputs are recorded in **files/logs** (For AI to reference later).
- [ ] Mechanisms so "Humans don't become bottlenecks" (Path to auto-Green).

## 11. SDD × TDD (Specs & Verification)

- [ ] Minimal **specification snapshot** is explicitly stated in natural language (What makes it Done).
- [ ] **Evidence** of Failing Test -> Minimal Implementation -> Green -> Refactor cycle.
- [ ] PR includes **test results or execution logs** (Short reproduction steps).

## 12. Security/Privacy (Minimal)

- [ ] Proper input validation (Unvalidated input causes SQLi/XSS).
- [ ] No hardcoded secrets (Use env vars or secret management).
- [ ] Safe cryptographic algorithms and proper key management.
- [ ] No dangerous functions/patterns (SQL string concatenation, `eval`, etc.).
- [ ] Proper authentication and session management.
- [ ] Proper authorization and access control.
- [ ] No known vulnerabilities in dependencies; no EOL versions.
- [ ] Don't commit secrets (Exclude `.env*`; use `.env.example`).
- [ ] External APIs have **exception handling and timeouts**.
- [ ] No issues with PII/License/Citations.

## 13. UI/UX (When applicable)

- [ ] Accessibility (Labels/ARIA/Focus) and Responsive design.
- [ ] Specs for error display and empty states are defined.

---

## 14. Approval/Rejection Criteria

**Approve**: Withstands future maintenance/integration based on the above.  
**Request Changes**:

- Unclear naming / Multiple responsibilities.
- Ambiguous comparison/boundaries/undefined handling.
- Magic numbers / Unaddressed duplication.
- Excessive optimization killing readability (No basis).
- Irreproducible (Manual/Interaction dependent) or lack of evidence.

## 15. Multi-Agent Development (SDD, TDD, Non-Blocking)

- **-DD (Specification Driven Development)**: Shared specs beyond natural language to avoid agent misunderstandings.
  - [ ] Specs defined as structured docs (OpenAPI, etc.) with terminology and business rules.
  - [ ] No ambiguous natural language specs remaining.
- **TDD (Test Driven Development)**: Write tests before implementation to clarify goals.
  - [ ] Acceptance tests written from user perspective.
  - [ ] Boundary conditions and edge cases covered by interface/contract tests.
- **Non-blocking (Humans don't stop progress)**: Review incrementally without hindering agent progress.
  - [ ] Interactions and decisions between agents are logged.
  - [ ] Humans review after Green tests, design review, and doc updates.
- **Notes**:
  - [ ] Humans make final judgment on complex business logic and security.
  - [ ] Check for risks agents might miss, like training data bias or API costs.

## Ethical Alignment and Algorithmic Fairness

AI systems can inherit and amplify human biases from training data, leading to unfair or discriminatory outcomes. Code generated or reviewed by AI must be evaluated carefully for these risks.

- [ ] Representation in training data: Does it reflect diversity (gender, race, age, etc.)?
- [ ] Misuse of proxy variables: Do neutral variables (ZIP code, etc.) act as proxies for protected attributes?
- [ ] Evaluation of fairness metrics: Is output fair across groups?
- [ ] Amplification of stereotypes: Does it reinforce harmful social stereotypes?
- [ ] Transparency and Accountability: Is logic traceable and explainable? Human responsibility is guaranteed.
