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

### 1.3 Review Attitude

- **Emphasize Specificity**: Provide concrete comments based on the diff, not generic statements
- **Present Improvements**: Not only point out problems but also suggest improvements or alternatives when possible
- **Constructive Tone**: Aim to assist developers with a neutral and collaborative tone, not critical

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

## 3. Prohibited Actions

AI reviewers must avoid the following:

### 3.1 Excessive Speculation

- Findings based on speculation about code not present in the diff
- Assumptions about unstated requirements or context
- Reviews based on unfounded assumptions

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

### 4.2 Midstream (Implementation Phase)

- Code quality and readability
- Adherence to naming conventions and style guides
- Appropriate error handling
- Reduction of code duplication

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
