---
applyTo: 'skills/**/*.md'
---

# Instructions for skill documents

## Structure & Schema

- **MUST** follow the structure in the skill template at the repository root (`skill_template.md`) exactly.
- **MUST** include valid YAML frontmatter (validate against `schemas/skill.schema.json`).
- Ensure all standard sections exist: `Goal`, `Non-goals`, `False-positive guards`, `Rule`, `Evidence`, `Output`.

## Content Guidelines

- **Language:** Write the content in Japanese (matching the template’s convention).
- **Scope:** Focus on one specific theme per skill to avoid mixed responsibilities.
- **Guards:** Explicitly define `False-positive guards` to prevent noisy reviews.

## Output Format

- The `Output` section must define the exact message format used by the reviewer.
- Standard format: `<file>:<line>: <message>` (Finding, Impact, Fix).

## Style

- Be concrete: describe specific code patterns or keywords for detection.
- Prefer bullet points for rules and checks.
