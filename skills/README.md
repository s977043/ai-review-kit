# River Review Skills

This directory contains River Review skills - reusable code review patterns organized by stream category (core/upstream/midstream/downstream).

## What are Skills?

Skills are modular, version-controlled review patterns that encapsulate:

- **Review logic** - What to check and how to check it
- **Context requirements** - What information the skill needs (diff, full file, tests, etc.)
- **Evaluation criteria** - How to measure the skill's effectiveness
- **Test fixtures** - Sample inputs and expected outputs

Each skill is a **first-class asset** with its own version, tests, and documentation.

## Directory Structure

```text
skills/
├── README.md                       # This file
├── registry.yaml                   # Skill catalog
├── _template.md                    # Skill frontmatter template
├── core/                           # Always-on or cross-stream skills (currently empty)
├── upstream/                       # Design & Architecture skills
│   └── <skill-id>/SKILL.md         # One directory per skill (frontmatter + Markdown)
├── midstream/                      # Implementation skills
│   └── <skill-id>/SKILL.md         # Includes community-contributed skills (recommended: false by default)
├── downstream/                     # Testing & Release skills
│   └── <skill-id>/SKILL.md
└── agent-skills/                   # Agent Skills format (entry/router skills; validated by npm run agent-skills:validate)
```

Some skills keep fixtures/prompt/eval assets in sibling folders (e.g. `fixtures/`, `eval/`) inside the skill directory, but the source of truth for each skill is its `SKILL.md`.

## Skill Format

Skills use a single format: YAML frontmatter + Markdown body.

Set `category` to one of `core`, `upstream`, `midstream`, or `downstream` (use `core` for always-on skills). `phase` remains for compatibility but `category` is the primary routing key.

```markdown
---
id: rr-midstream-example-001
name: Example Skill
description: Example skill description
category: midstream
phase: midstream
applyTo:
  - 'src/**/*.ts'
path_patterns: # optional alias for applyTo
  - 'src/**/*.{ts,tsx}'
tags: [sample, midstream]
severity: minor
inputContext: [diff]
outputKind: [findings, actions]
modelHint: balanced
priority: 10
---

## Guidance

- Keep review instructions concise (around 10 lines) and actionable.
- Include Non-goals and False-positive guards to control noise.
```

## Creating a New Skill

### Using the Scaffolding Tool (Recommended)

```bash
npm run create:skill
```

This interactive tool will:

1. Prompt for skill metadata (ID, name, description, etc.)
2. Generate a Markdown skill file with YAML frontmatter
3. (Optional) Create fixture/eval folders if needed

### Manual Creation

1. Copy the template:

   ```bash
   mkdir -p skills/<phase>/<skill-id>
   cp skills/_template.md skills/<phase>/<skill-id>/SKILL.md
   ```

2. Fill in the YAML frontmatter (id, name, description, category, applyTo, inputContext, outputKind, priority, etc.)
3. Keep the body concise with Guidance / Non-goals / False-positive guards
4. (Optional) Add fixtures or promptfoo configs under a sibling directory if you need evaluations

## Validating Skills

```bash
npm run skills:validate
```

## Testing Skills

### Run promptfoo Evaluation

```bash
cd skills/<phase>/<skill-id>
npx promptfoo eval
```

### Run All Fixture Tests

```bash
npm run eval:fixtures
```

## Stream Categories

### Core

Focus: Always-on checks that apply to every stream (e.g., review policies, global safety rails)

- **Input Context**: Depends on the skill; should avoid heavy or stream-specific assumptions
- **Output**: Cross-cutting guidance or guardrails
- **Examples**: Review policy baselines, output shaping rules

### Upstream (Design & Architecture)

Focus: Design decisions, ADRs, architecture patterns

- **Input Context**: ADR files, design docs, commit messages
- **Output**: Design feedback, alternative suggestions, questions
- **Examples**: ADR quality, API design review, architecture patterns

### Midstream (Implementation)

Focus: Code quality, security, observability

- **Input Context**: Diff, full files, tests
- **Output**: Code findings, refactoring suggestions, security alerts
- **Examples**: Code quality, security scan, observability checks

### Downstream (Testing & Release)

Focus: Test coverage, release readiness

- **Input Context**: Test files, coverage reports, diff
- **Output**: Test recommendations, coverage gaps, release checklist
- **Examples**: Test coverage, integration test review

## Registry

The `registry.yaml` file maintains a catalog of all skills with:

- Skill metadata and versions
- Tag-based categorization
- Recommended skills for common use cases
- Phase-based organization

See [registry.yaml](./registry.yaml) for the complete catalog.

## Best Practices

1. **One skill, one concern** - Keep skills focused on a single review aspect
2. **Write tests** - Add fixtures and golden files for regression testing
3. **Document thoroughly** - Include clear examples and non-goals
4. **Version carefully** - Use semantic versioning for breaking changes
5. **Evaluate regularly** - Run promptfoo evaluations to measure effectiveness

## References

- [Skill Metadata](../pages/reference/skill-metadata.md)
- [Skill Template](./_template.md)
- [promptfoo Documentation](https://www.promptfoo.dev/)
- [River Review Documentation](../docs/policy/DOCUMENTATION.md)
