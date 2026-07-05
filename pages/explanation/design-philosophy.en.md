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

- **A general-purpose AI agent framework**: it is a context engineering framework specialized for code review, not a generic task execution platform. The review team, too, is a single orchestrator running perspective-based reviewer roles in parallel and merging their findings via connected-components — not a set of fully autonomous, independent agents.
- **A replacement for human review judgment**: AI assists by surfacing review perspectives and evidence. Findings and the verdict are decision material only; GO / NO-GO, iteration, and stop decisions remain the responsibility of the caller or a human (HITL). It does not assert auto-approval or auto-merge.
- **An automatic code fixer**: it identifies and reports issues but does not transform or auto-fix code.

## Direction of travel: risk-tiered human supervision

River Review splits change into three risk tiers and varies how much human supervision each tier receives. The cliff tier — high-risk changes — keeps HITL: human approval stays mandatory. On top of that, the hill tier imposes time-boxed observation, and the field tier lets clean, converged changes continue autonomously and audits them after the fact. The goal is to reallocate scarce human attention to the cliff, not to reduce supervision. See [ADR-003](../../docs/adr/003-risk-tiered-human-supervision.md) for details.

The "replacement for human review judgment" Non-Goal above is not a permanent constraint but a current milestone. Even the areas judged to require humans only (misalignment with intent, soundness of design decisions, risk weighting, tacit assumptions) become reviewable by AI to the extent that the right context can be extracted and shaped for it.

- **Cliff (ESCALATE)**: high-risk changes require human approval and preserve HITL. The final call here is always a human's.
- **Hill (GO_WITH_OBSERVATION)**: continuation is allowed but carries time-boxed observation; once the deadline passes, the change reverts to unreviewed.
- **Field (GO)**: clean, converged changes may continue autonomously and are audited after the fact via the run-record and digest.
- **Precondition for wider automation**: expanding the automated scope is limited to what finding verification and improvement-loop feedback back up. It widens first for perspectives where consensusLevel and verification track records have accumulated — never ahead of that evidence.

As a design principle for loop supervision, the human's role shifts from judging every instance to supervising the loop and stepping in only when needed (Human-on-the-Loop). The banner remains risk-tiered human supervision, and the cliff's human approval is never relaxed.
