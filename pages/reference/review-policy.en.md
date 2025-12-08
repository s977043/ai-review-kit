# AI Review Standard Policy

This document defines the standard policy that River Reviewer's AI reviewers must follow. The policy aims to maintain consistent review quality and reproducibility while providing valuable and constructive feedback to developers.

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

River Reviewer adopts flow-based reviews, emphasizing the following in each phase:

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

## Related Documents

- [Skill Metadata](./metadata-fields.md): Skill metadata specification
- [Design Philosophy](../explanation/design-philosophy.md): River Reviewer's design philosophy
- [River Architecture](../explanation/river-architecture.md): Overall architecture
