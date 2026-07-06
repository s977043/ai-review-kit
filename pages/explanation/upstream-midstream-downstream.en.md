# Upstream, Midstream, Downstream

River Review mirrors the natural flow of software delivery:

- **Upstream**: ideas, requirements, and design decisions. Checks focus on clarity, traceability, and feasibility.
- **Midstream**: implementation and refactoring. Checks focus on correctness, code health, and keeping changes consistent with the upstream plan.
- **Downstream**: testing, release readiness, and observability. Checks focus on verification, resiliency, and user impact.

Each skill declares its phase so the runner can load only the relevant guidance for a change. When in doubt, prefer the earliest phase that can catch the issue to keep feedback fast.

These three phases are an axis that describes the SDLC flow; they are distinct from the product's three core axes (capability pack / Skill Registry / review team). The three axes apply across every phase. Perspective-based skills from the Skill Registry are distributed to each phase, and the review team (`agents/river-review.md` / the perspective-based reviewer roles in `src/lib/reviewer-orchestrator.mjs`, run in parallel and merged via connected-components) runs them as a capability pack.

In every phase, River Review's role is to **review** — to surface issues, risks, and missing information. Findings and the verdict stay as decision material; the decision to **stop or pass** the work belongs to PlanGate and to a human (HITL). That stop-or-pass decision is allocated by risk tier (cliff = human approval required / hill = time-boxed observation / field = autonomous convergence plus post-hoc audit).
