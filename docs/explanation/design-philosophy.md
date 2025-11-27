# Design Philosophy

River Reviewer is built to deliver timely, phase-aware feedback without slowing teams down.

- **Flow-first**: every check should state which phase it belongs to and why.
- **Small, testable steps**: prefer narrowly scoped skills with clear acceptance signals.
- **Schema-driven**: `/schemas/skill.schema.json` is the contract for all skills and should stay the single source of truth.
- **Empathetic tone**: findings should be actionable and constructive, matching the friendly river brand.
- **Evidence-based**: link guidance to commands or links that prove the recommendation.
