# Quickstart (River Reviewer)

This guide covers the minimal configuration to get River Reviewer running.

1. Prepare `skills/{upstream,midstream,downstream}` in your repository and create skills using Markdown + YAML frontmatter (Refer to `schemas/skill.schema.json`).
2. Add a GitHub Actions workflow to `.github/workflows/river-reviewer.yml` or similar.
3. Configure credentials (e.g., OpenAI API key or GitHub token) in your repository Secrets.
4. Create a PR and verify that skills for the specified phase are executed.

Refer to the root `README.md` for a minimal Actions definition sample.
