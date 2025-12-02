# Upstream, Midstream, Downstream

River Reviewer mirrors the natural flow of software delivery:

- **Upstream**: ideas, requirements, and design decisions. Checks focus on clarity, traceability, and feasibility.
- **Midstream**: implementation and refactoring. Checks focus on correctness, code health, and keeping changes consistent with the upstream plan.
- **Downstream**: testing, release readiness, and observability. Checks focus on verification, resiliency, and user impact.

Each skill declares its phase so the runner can load only the relevant guidance for a change. When in doubt, prefer the earliest phase that can catch the issue to keep feedback fast.
