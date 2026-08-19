# AI Review Standard Policy

This document defines the standard policy that River Review's AI reviewers must follow. The policy aims to maintain consistent review quality and reproducibility while providing valuable and constructive feedback to developers.

## 1. Evaluation Principles

AI reviewers evaluate PR diffs based on the following criteria:

### 1.1 Analysis Focus

- **Intent Understanding**: Read the purpose and context from the diff and evaluate accordingly
- **Risk Identification**: Specifically point out potential bugs, overlooked edge cases, and inconsistencies
- **Impact Assessment**: Analyze how changes affect other components and features

### 1.2 Evaluation Perspectives

Reviews are conducted from the following perspectives:

- **Readability**: Code comprehensibility, naming appropriateness, structural clarity
- **Extensibility**: Flexibility for future changes and feature additions
- **Performance**: Execution efficiency, resource usage, scalability
- **Security**: Vulnerabilities, data protection, authentication and authorization appropriateness
- **Maintainability**: Debuggability, test coverage, documentation
- **Operations**: Observability, ease of incident investigation, safe rollout and rollback. For diffs touching infra, schema, config, public APIs, or authorization, check log/monitoring sufficiency, secret leakage, migration safety, the need for feature flags or staged rollout, and the blast radius on failure.
- **Plan alignment**: For large, first-touch, or design-heavy changes, whether deviations from the plan (plan / design / requirements) and their reasons are recorded in the PR and open to review. Not required for small fixes, clear bug fixes, or pattern-following additions.
- **Rationale traceability**: Whether How is traceable in the code, What in the tests, Why in the Issue / Plan / PR, and Why not in comments / ADRs. What matters is not the volume of documentation but whether the knowledge needed for a decision sits in the right place and matches the current diff. When an artifact was never supplied as review input, report it as missing input rather than asserting that the rationale is absent. See `docs/review/rationale-traceability.md` in the repository for the full definition and finding taxonomy (Japanese only — `docs/` carries no English edition).
- **UX (Usability)**: For diffs touching user-facing operations, whether outcomes and failures are visible to the user and mistakes are recoverable. Covers confirmation steps and undo paths for destructive operations (delete, overwrite, irreversible actions), error messages that show how to recover from invalid input, and the presentation of pending, failure, and empty states. Findings are limited to what can be anchored to code present in the diff.

### 1.3 Review Attitude

- **Emphasize Specificity**: Provide concrete comments based on the diff, not generic statements
- **Present Improvements**: Not only point out problems but also suggest improvements or alternatives when possible
- **Constructive Tone**: Aim to assist developers with a neutral and collaborative tone, not critical
- **Healthy Skepticism toward Generated Code**: In AI-generated code, plausible-looking references and implementations may not match reality or intent. Verify that newly introduced references and API usages actually exist before evaluating them

## 2. Output Format

AI review outputs follow this structure:

### 2.1 Summary

- Briefly summarize the key points of the changes
- Highlight major concerns or notable points
- Provide an overall assessment (balance of good points and improvements)

### 2.2 Comments (Specific Findings)

- Specific findings at the line or file level
- Each comment should include:
  - **Target Location**: File name and line number
  - **Issue**: What the problem is and why it's a problem
  - **Impact**: Potential consequences of this issue
  - **Severity**: info / minor / major / critical

### 2.3 Suggestions (Improvement Proposals)

- Concrete improvement proposals or alternative implementations
- Show code examples or refactoring directions
- Provide links to relevant documentation or best practices when necessary

### 2.4 Optional Sections

To strengthen the basis for judgment, add the following when useful. All are optional and do not change the severity labels or finding structure (backward-compatible).

- **Good Points**: Sound design decisions or appropriate test additions worth keeping, so the review is not purely a list of problems.
- **Missing Tests**: Test angles that should be added (absent error/boundary/regression cases). Surfaces the absence of tests, which is hard to express as a finding.
- **Follow-up Issues**: Concerns outside this change's scope that should be tracked separately. Connects to the practice of tracking non-blocker Majors in separate issues.
- **Unverified / Residual Risk**: Assumptions the review could not verify, behavior it could not observe, and concerns that remain — stated for the report as a whole, separately from findings, so the limits of the judgment stay traceable.
  - **Unknown Coverage (residual Unknowns / evidence_missing / resolution)**: A sub-structure of the residual-risk section that lays out the Unknowns remaining at review time in a structured form. Each Unknown carries category, severity, blocking, evidence_missing (the evidence not yet gathered), and resolution (how to close it). It separates risks that were checked and accepted from risks left unverified, and it associates resolved Unknowns with evidence. The mapping to a verdict follows the table in [loop-convergence-contract.md](./loop-convergence-contract.md) and introduces no new vocabulary.

### 2.5 Ordering and Progressive Disclosure

Order the output so a reader can decide "is there anything to fix before merging?" from the very first line. Put the verdict, the per-severity counts, and the score at the top; push the review execution log below them.

- **Summary pinned to the top**: the verdict, per-severity counts, score, and phase belong on the first line of the body.
- **Severity-driven disclosure**: Critical and Major stay expanded; Minor and Info are collapsed.
- **Collapsing is not omitting**: a collapsed section keeps the full text of every finding — no summarizing, deleting, or truncating.
- **Counts in the heading**: every collapsed section states its count, so the reader can judge the volume without expanding it.
- **Execution log last**: selected skills, skip reasons, and the score breakdown are execution records; collapse them and place them after the result.
- **Mark what the diff did not introduce**: a finding that does not come from this PR's added lines (`pre-existing`) carries a mark right after its location reference. The default value, `in-diff`, is never marked.
- **State the scope once**: on a marked finding, drop the reviewer's self-reported scope label from the body. One finding must never show two opposite scopes.

The severity labels stay Critical / Major / Minor / Info — progressive disclosure adds no new vocabulary. The scope mark is not a severity label, so it does not violate that constraint. A presentation change must never rewrite a finding's severity or the auto-approval decision.

This section is a rule for the side that **renders** the report. Do not put raw HTML such as `<details>` inside an individual finding body: a collapsible block embedded in a finding collides with the section structure the renderer builds around it. The renderer escapes raw HTML for safety, so such markup is shown as literal text rather than becoming a collapsible block.

## 3. Prohibited Actions

AI reviewers must avoid the following:

### 3.1 Excessive Speculation

- Findings based on speculation about code not present in the diff
- Assumptions about unstated requirements or context
- Reviews based on unfounded assumptions

Note that "absence findings" (pointing out something that does not exist, such as a missing confirmation step or missing error-state handling) do not fall under this prohibition as long as they are anchored to trigger code that exists in the diff (`file:line`). If a code search cannot rule out that the missing piece exists outside the diff or in another file, return a question instead of a finding.

When a comment or docblock adjacent to the cited line states the design intent behind the code, do not repeat a suggestion the comment already answers without addressing that intent. If a problem remains once the stated intent is taken into account, report it together with a summary of that intent and the reason the problem still stands. Comments are not trusted unconditionally: when a comment contradicts the implementation it documents, the contradiction itself is the finding.

Dropping a finding because of an intent comment is permitted only for nits, style, and design-preference points whose concern the stated intent fully resolves. Security, data-loss, and correctness risks must always be reported, even when a comment marks them as `intentional`. Severity feeds the final verdict directly, so a single comment inside the diff must never be able to flip a go/no-go decision.

### 3.2 Abstract Reviews

- Reviews with only generic statements (no specific reference to the diff)
- Vague findings like "should follow best practices"
- Comments without actionable steps

### 3.3 Inappropriate Tone

- Critical or aggressive tone
- Personal or capability attacks
- Sarcastic or mocking expressions

### 3.4 Out-of-Scope Findings

- Excessive review of unchanged code
- Findings unrelated to the PR's purpose
- Suggestions that contradict style guides or project conventions

## 4. Phase-Specific Considerations

River Review adopts flow-based reviews, emphasizing the following in each phase (see [Upstream / Midstream / Downstream phases](../explanation/upstream-midstream-downstream.md) for a conceptual overview):

### 4.1 Upstream (Design Phase)

- Consistency with architecture decisions
- Verification against ADRs (Architecture Decision Records)
- Clarity of design intent
- Appropriateness of interface design
- Restraint of over-implementation: question speculative abstractions, unused extension points, and excessive generalization that appear in the diff or ADRs against current requirements. Code-level duplication and simplification belong to the Midstream quality perspectives, and this is distinct from the plan-artifact-based over-implementation checks of the PlanGate skills.
- Self-sufficiency of the API/tool layer: whether APIs and tool definitions work safely and self-descriptively on their own, assuming no UI guardrails. Concrete detection is handled by skills such as `trust-boundaries-authz` and `nextjs-server-action-security`; this item names their shared principle.

### 4.2 Midstream (Implementation Phase)

- Code quality and readability
- Adherence to naming conventions and style guides
- Appropriate error handling
- Reduction of code duplication
- Async correctness (missing await, floating promises, race conditions — distinct from parallelization suggestions for efficiency)

### 4.3 Downstream (Test/QA Phase)

- Test coverage
- Edge case testing
- Test readability and maintainability
- Test execution performance

## 5. Quality Standards

AI reviews must meet the following quality standards:

### 5.1 Accuracy

- Findings are technically correct
- Not based on incorrect information or speculation
- Based on current best practices

### 5.2 Practicality

- Content that developers can actually act upon
- Include concrete code examples or procedures
- Balanced implementation cost and effectiveness

### 5.3 Consistency

- Align with existing project conventions
- Provide consistent findings for the same issues
- Evaluate at appropriate granularity according to the phase

## 6. Review Priority

To achieve maximum effectiveness with limited resources, evaluate in the following priority:

1. **Critical**: Security vulnerabilities, data loss risk, system downtime possibility
2. **Major**: Significant bugs, performance issues, major design problems
3. **Minor**: Small bugs, readability issues, minor optimization opportunities
4. **Info**: Suggestions, reference information, additional considerations

## 7. Continuous Improvement

This policy itself is continuously improved:

- Collect and incorporate feedback from review results
- Adopt new best practices and technology trends
- Allow customization according to project-specific needs

## 8. Review Mode Router / Automatic Review Depth Selection

The `river review route` sub-command statically analyzes the change set and automatically selects the appropriate review depth. It evaluates risk-map rules, the number of changed files and lines, and file types in priority order, then classifies the result into one of four modes.

### 8.1 Mode Classification

| Router Mode      | Internal reviewMode | Equivalent `--depth` | Description                                                                                               |
| ---------------- | ------------------- | -------------------- | --------------------------------------------------------------------------------------------------------- |
| `light`          | `tiny`              | `quick`              | Changes limited to docs or tests only. Minimum cost.                                                      |
| `standard`       | `medium`            | `standard`           | Normal application code changes.                                                                          |
| `team`           | `large`             | `thorough`           | Migration, schema, or large-scale changes. `--reviewers auto` is recommended.                             |
| `human-required` | (none)              | (none)               | A `require_human_review` rule in the risk-map was matched. Human review is required instead of AI review. |

### 8.2 Routing Triggers (in priority order)

1. risk-map `require_human_review` → `human-required`
2. risk-map `escalate` → `team` or higher
3. Migration or schema file changes → `team` or higher
4. Changed file count ≥ 20 or changed line count ≥ 500 → `team` or higher
5. Infra or config file changes → `standard` or higher
6. Docs or test files only → `light`
7. Default → `standard`

### 8.3 Output Fields

The router outputs the following fields:

- `selectedMode`: The selected mode (`light` / `standard` / `team` / `human-required`)
- `confidence`: Confidence level of the decision (`high` / `medium`)
- `reasons`: Explanation of why the mode was selected
- `matchedTriggers`: List of triggers that were matched
- `recommendedReviewers`: Recommended reviewers (when mode is `team`)
- `riskAction`: The action applied from the risk-map
- `nextCommand`: Suggested CLI command to run next

### 8.4 CLI Usage Examples

```bash
# Route the diff in the current directory (JSON output)
river review route .

# Output in markdown format
river review route . --format markdown

# Compare against a specific base branch
river review route . --base main
```

## Related Documents

- [Skill Metadata](./metadata-fields.md): Skill metadata specification
- [Design Philosophy](../explanation/design-philosophy.md): River Review's design philosophy
- [River Architecture](../explanation/river-architecture.md): Overall architecture
