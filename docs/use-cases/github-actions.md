# Using River Review with GitHub Actions

GitHub Actions is the primary interface for running River Review skills on pull requests. This guide shows how to integrate skills into your CI/CD workflow.

## Quick Start

### Minimal Configuration

```yaml
# .github/workflows/code-review.yml
name: AI Code Review
on:
  pull_request:
    branches: [main]

jobs:
  review:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      issues: write
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0 # Required for git diff

      - name: Run River Review
        uses: s977043/river-review/runners/github-action@v0.33.0
        with:
          phase: midstream
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

This runs all `midstream` skills on changed files and posts findings as PR comments.

## Understanding Phases

River Review organizes skills by SDLC phase:

| Phase          | Focus                 | When to Run                 | Example Skills                        |
| -------------- | --------------------- | --------------------------- | ------------------------------------- |
| **upstream**   | Design & Architecture | On ADR changes, design docs | Architecture patterns, API design     |
| **midstream**  | Implementation        | On source code changes      | Code quality, security, observability |
| **downstream** | Testing & QA          | On test file changes        | Coverage gaps, test quality           |
| **all**        | Cross-cutting         | Always                      | Documentation, commit message quality |

### Phase-Specific Workflows

Run different skills based on what changed:

```yaml
name: Phase-Aware Review
on:
  pull_request:
    branches: [main]

jobs:
  # Design review when ADRs change
  upstream-review:
    if: contains(github.event.pull_request.changed_files, 'docs/adr/')
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v6
        with: { fetch-depth: 0 }
      - uses: s977043/river-review/runners/github-action@v0.33.0
        with: { phase: upstream }
        env: { OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }} }

  # Code review on source changes
  midstream-review:
    if: contains(github.event.pull_request.changed_files, 'src/')
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v6
        with: { fetch-depth: 0 }
      - uses: s977043/river-review/runners/github-action@v0.33.0
        with: { phase: midstream }
        env: { OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }} }

  # Test review on test changes
  downstream-review:
    if: contains(github.event.pull_request.changed_files, 'tests/')
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v6
        with: { fetch-depth: 0 }
      - uses: s977043/river-review/runners/github-action@v0.33.0
        with: { phase: downstream }
        env: { OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }} }
```

### Parallel Phase Execution

Run all phases in parallel for faster feedback:

```yaml
name: Parallel Review
on:
  pull_request:
    branches: [main]

jobs:
  review:
    strategy:
      matrix:
        phase: [upstream, midstream, downstream]
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v6
        with: { fetch-depth: 0 }
      - uses: s977043/river-review/runners/github-action@v0.33.0
        with: { phase: ${{ matrix.phase }} }
        env: { OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }} }
```

## Action Inputs

| Input           | Required | Default       | Description                                                 |
| --------------- | -------- | ------------- | ----------------------------------------------------------- |
| `phase`         | No       | `all`         | SDLC phase: `upstream`, `midstream`, `downstream`, or `all` |
| `skills-dir`    | No       | `skills`      | Path to skills directory                                    |
| `base-ref`      | No       | Auto-detected | Base branch for diff (usually `main`)                       |
| `head-ref`      | No       | Auto-detected | Head branch for diff (PR branch)                            |
| `output-format` | No       | `pr-comment`  | Output format: `pr-comment`, `json`, `markdown`             |

### Example: Custom Skills Directory

```yaml
- uses: s977043/river-review/runners/github-action@v0.33.0
  with:
    phase: midstream
    skills-dir: custom-skills # Use custom skill location
```

### Example: JSON Output

```yaml
- uses: s977043/river-review/runners/github-action@v0.33.0
  with:
    phase: midstream
    output-format: json
  id: review

- name: Process Results
  run: |
    echo "Findings: ${{ steps.review.outputs.findings }}"
    # Parse JSON and create custom reports
```

## Environment Configuration

### LLM Provider Setup

The GitHub Action review flow currently supports **OpenAI only**. Configure via environment variables:

**OpenAI:**

```yaml
env:
  OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
  OPENAI_MODEL: gpt-4o # Optional, defaults to gpt-4o
```

You can also use `RIVER_OPENAI_API_KEY` / `RIVER_OPENAI_MODEL` to avoid clashing with other tools that rely on the standard `OPENAI_*` variables, and `RIVER_OPENAI_BASE_URL` to point the client at an OpenAI-compatible endpoint.

> **Note**: At the time of writing, the core review pipeline invoked by the GitHub Action is hard-wired to the OpenAI chat-completions API. Non-OpenAI providers (Anthropic, Azure OpenAI, Google Gemini, …) are not called by this path—configuring them will cause the LLM step to be skipped with a `provider ... is not supported yet` message.
>
> A separate dispatcher (`river skills`, driven by `src/core/skill-dispatcher.mjs`) does support additional providers (OpenAI + Google Gemini) via `AIClientFactory`, but that code path is not used by the GitHub Action workflow documented here.

### Adding Secrets to Repository

1. Go to repository Settings → Secrets and variables → Actions
2. Click "New repository secret"
3. Name: `OPENAI_API_KEY` (or provider of choice)
4. Value: Your API key
5. Click "Add secret"

## Advanced Patterns

### Conditional Review Based on File Patterns

Only run review when specific files change:

```yaml
name: Conditional Review
on:
  pull_request:
    paths:
      - 'src/**/*.ts'
      - 'src/**/*.tsx'
      - '!src/**/*.test.ts'  # Exclude test files

jobs:
  review:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v6
        with: { fetch-depth: 0 }
      - uses: s977043/river-review/runners/github-action@v0.33.0
        with: { phase: midstream }
        env: { OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }} }
```

### Multi-Repository Skills

Share skills across multiple repositories:

```yaml
# In each repository
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with: { fetch-depth: 0 }

      # Checkout shared skills
      - name: Checkout shared skills
        uses: actions/checkout@v6
        with:
          repository: your-org/shared-skills
          path: shared-skills

      - uses: s977043/river-review/runners/github-action@v0.33.0
        with:
          phase: midstream
          skills-dir: shared-skills
        env: { OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }} }
```

### Cost Control with Limits

Set limits to control LLM API costs:

```yaml
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with: { fetch-depth: 0 }

      - uses: s977043/river-review/runners/github-action@v0.33.0
        with:
          phase: midstream
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          MAX_FILES_PER_SKILL: 10 # Limit files processed
          MAX_SKILLS_PER_RUN: 5 # Limit skills executed
```

### Approval Required Before Running

Use workflow dispatch for manual approval:

```yaml
name: Manual Review
on:
  workflow_dispatch:
    inputs:
      pr_number:
        description: 'PR number to review'
        required: true
      phase:
        description: 'Review phase'
        required: true
        default: 'midstream'
        type: choice
        options:
          - upstream
          - midstream
          - downstream
          - all

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          ref: refs/pull/${{ inputs.pr_number }}/head
          fetch-depth: 0

      - uses: s977043/river-review/runners/github-action@v0.33.0
        with:
          phase: ${{ inputs.phase }}
        env: { OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }} }
```

### Draft PRs Only

Run review only on draft PRs to save costs:

```yaml
name: Draft PR Review
on:
  pull_request:
    types: [opened, synchronize, converted_to_draft]
    branches: [main]

jobs:
  review:
    if: github.event.pull_request.draft == true
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with: { fetch-depth: 0 }
      - uses: s977043/river-review/runners/github-action@v0.33.0
        with: { phase: midstream }
        env: { OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }} }
```

## Output Formats

### PR Comments (Default)

Findings posted as review comments on changed lines:

```markdown
**Finding:** SQL injection vulnerability
**Evidence:** Line 15: `db.query(\`SELECT _ FROM users WHERE id = ${id}\`)`**Fix:** Use parameterized queries:`db.query('SELECT _ FROM users WHERE id = ?', [id])`
**Severity:** major
```

### JSON Output

Structured data for custom processing:

```json
{
  "findings": [
    {
      "skill": "security-basic",
      "file": "src/api/users.ts",
      "line": 15,
      "severity": "major",
      "message": "SQL injection vulnerability",
      "suggestion": "Use parameterized queries"
    }
  ],
  "summary": {
    "total": 1,
    "by_severity": {
      "major": 1
    }
  }
}
```

### Markdown Report

Formatted report for artifacts:

```markdown
# Code Review Report

## Summary

- **Total Findings:** 3
- **Critical:** 0
- **Major:** 1
- **Minor:** 2

## Findings

### src/api/users.ts

**SQL Injection Vulnerability** (major)
Line 15: ...
```

## Troubleshooting

### "No skills matched"

**Cause:** No skills match the phase or file patterns.

**Solution:**

1. Check `phase` input matches skill metadata
2. Verify file patterns in skill's `applyTo` field
3. Ensure changed files match skill patterns

### "API key not configured"

**Cause:** LLM provider API key not set.

**Solution:**

1. Add API key to repository secrets
2. Reference in workflow: `${{ secrets.OPENAI_API_KEY }}`
3. Verify secret name matches environment variable

### "Rate limit exceeded"

**Cause:** Too many API requests.

**Solution:**

1. Use `MAX_FILES_PER_SKILL` to limit processing
2. Add delays between skill executions
3. Use `modelHint: cheap` for lightweight skills
4. Consider batching file reviews

### "Fetch depth insufficient"

**Cause:** `fetch-depth: 0` not set in checkout.

**Solution:**

```yaml
- uses: actions/checkout@v6
  with:
    fetch-depth: 0 # Required for git diff
```

## Best Practices

1. **Use Specific Phases** - Run only relevant skills to save time and costs
2. **Pin Action Versions** - Use `@v0.33.0` instead of `@main` for stability
3. **Set Permissions Explicitly** - Define minimum required permissions
4. **Monitor API Usage** - Track LLM API costs and set budgets
5. **Test Locally First** - Validate skills work before running in CI
6. **Use Conditional Triggers** - Only run on specific file patterns
7. **Implement Cost Controls** - Set limits on files and skills per run

## Examples

### Example 1: TypeScript Project

```yaml
name: TypeScript Review
on:
  pull_request:
    paths:
      - '**/*.ts'
      - '**/*.tsx'

jobs:
  code-quality:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v6
        with: { fetch-depth: 0 }
      - uses: s977043/river-review/runners/github-action@v0.33.0
        with: { phase: midstream }
        env: { OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }} }

  test-quality:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v6
        with: { fetch-depth: 0 }
      - uses: s977043/river-review/runners/github-action@v0.33.0
        with: { phase: downstream }
        env: { OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }} }
```

### Example 2: Multi-Phase Review

```yaml
name: Comprehensive Review
on:
  pull_request:
    branches: [main, develop]

jobs:
  review:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      issues: write
    strategy:
      matrix:
        include:
          - phase: upstream
            name: Design Review
          - phase: midstream
            name: Code Review
          - phase: downstream
            name: Test Review
    name: ${{ matrix.name }}
    steps:
      - uses: actions/checkout@v6
        with: { fetch-depth: 0 }
      - uses: s977043/river-review/runners/github-action@v0.33.0
        with: { phase: ${{ matrix.phase }} }
        env: { OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }} }
```

## Resources

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [River Review Action Source](https://github.com/s977043/river-review/tree/main/runners/github-action)
- [Example Workflows](https://github.com/s977043/river-review/tree/main/.github/workflows)
- [Skills Concepts](../../pages/explanation/skills.en.md)

## Next Steps

1. **Copy a workflow example** above
2. **Add your API key** to repository secrets
3. **Open a test PR** to trigger the workflow
4. **Review the findings** posted as PR comments
5. **Customize skills** to match your team's needs
