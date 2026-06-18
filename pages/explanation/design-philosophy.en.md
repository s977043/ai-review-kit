# Design Philosophy

River Review is grounded in turning a team's tacit knowledge into versioned, repo-owned Skills (the Skill Registry) that are reused as a shared asset. On that foundation sit three core axes: a capability pack that strengthens an AI agent's review ability, review skills shared as the Skill Registry, and a review team that runs perspective-based reviewers in parallel. The principles below are the design decisions that support those three axes.

River Review is built to deliver timely, phase-aware feedback without slowing teams down.

- **Flow-first**: every check should state which phase it belongs to and why.
- **Small, testable steps**: prefer narrowly scoped skills with clear acceptance signals.
- **Schema-driven**: `/schemas/skill.schema.json` is the contract for all skills and should stay the single source of truth.
- **Empathetic tone**: findings should be actionable and constructive, matching the friendly River Review brand.
- **Evidence-based**: link guidance to commands or links that prove the recommendation.
- **Context-aware**: systematically design the context passed to the LLM. Maximize review quality within a bounded context budget through skill selection, diff filtering, and progressive disclosure.

## Non-Goals

River Review does **not** aim to be:

- **A general-purpose AI agent framework**: it is a context engineering framework specialized for code review, not a generic task execution platform. The review team, too, is a single orchestrator running perspective-based reviewer roles in parallel and merging their findings via connected components — not a set of fully autonomous, independent agents.
- **A replacement for human review judgment**: AI assists by surfacing review perspectives and evidence. Findings and the verdict are decision material only; GO / NO-GO, iteration, and stop decisions remain the responsibility of the caller or a human (HITL). It does not assert auto-approval or auto-merge.
- **An automatic code fixer**: it identifies and reports issues but does not transform or auto-fix code.
