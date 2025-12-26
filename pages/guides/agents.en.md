# Agents—Adding Project Knowledge Packs

This guide outlines the steps to reuse PocketEitan AI agent assets in external repositories. Create knowledge packs for new projects based on `agents/spec/agent.schema.json` and `agents/examples/*.agent.yaml`.

## Directory Structure

```text
agents/
├── spec/agent.schema.json      # JSON Schema (validated via AJV)
└── examples/
    └── pocket-eitan.agent.yaml # Example from PocketEitan
```

## Steps to Add

1. Create `<project>.agent.yaml` in `agents/examples/`
   - `version`: Version complying with the schema (e.g., `v1.0.0`)
   - `metadata`: Repository info (owner/repository, license, tags, updatedAt, etc.)
   - `guidelines`: Project-specific principles, processes, and prohibitions.
   - `tooling`: Package management, languages, quality gates, DoD.
   - `agents`: Role-based prompts and review instructions (Codex/Gemini/Copilot, etc.).
   - `resources`: Reference docs, checklists, and knowledge.
   - `automation`: Automation assets like GitHub Actions.

2. Follow the same schema for projects other than PocketEitan
   - Copy existing examples and replace fields.
   - Do not include extra fields (Schema uses `additionalProperties: false`).

3. Add/Update checklists under `.github/river-reviewer/checklists/`
   - Add necessary categories like `security.md`, `language/*.md`, `quality/*.md`.
   - Use the PocketEitan examples as a reference to write bullet points that AI agents can review.

4. Update documentation and README
   - Add procedures and commands to `pages/guides/agents.md` (this file) and the root README.
   - Include background, changes, test results, impact scope, and checklists in PR templates.

## Validation Commands

A validation script using AJV + js-yaml is included in `package.json`.

```bash
# Example: Validate all sample files against the schema
npm run agents:validate
```

The same validation is performed in CI via `.github/workflows/validate-agents.yml`.

## Best Practices

- Identify sections to add or remove using the PocketEitan YAML as a base.
- Update `metadata.updatedAt` using ISO 8601 (UTC).
- Explicitly state project-specific risks and mitigations in `guidelines.security`.
- Record CI name, path, trigger, and quality gates in `automation.ciWorkflows`.
- Always run `pnpm agents:validate` in addition to `pnpm lint && pnpm test` after changes.
