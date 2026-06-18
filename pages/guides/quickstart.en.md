# Quickstart (River Review)

This guide covers the minimal configuration to get River Review running. River Review turns tacit knowledge into versioned, repo-owned Skills (a Skill Registry) shared as a team asset, and runs on three axes: a capability pack (usually no LLM key needed), review skills, and a review team of perspective-based reviewers. The headless GitHub Action this guide sets up is one path for calling those three axes from CI.

1. Prepare `skills/{upstream,midstream,downstream}` in your repository and create skills using Markdown + YAML frontmatter (Refer to `schemas/skill.schema.json`). See [Upstream / Midstream / Downstream phases](../explanation/upstream-midstream-downstream.md) for an explanation of each phase.
2. Add a GitHub Actions workflow to `.github/workflows/river-review.yml` or similar.
3. Configure an LLM API key (`OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GOOGLE_API_KEY`) in your repository Secrets for the GitHub Action. Additional tokens are only needed for custom integrations or extensions. Note that **an LLM key is required only for this headless GitHub Action (or the standalone CLI)** — **normal use, where an AI agent (Claude Code / Cursor / …) applies the skills, needs no key** (see [What is River Review § Execution model](../explanation/what-is-river-review.en.md)).
4. Create a PR and verify that skills for the specified phase are executed.

Refer to the root `README.md` for a minimal Actions definition sample.
