# River Reviewer Glossary

- **Upstream**: requirements, design, and architecture phase (including ADRs) where early review prevents costly rework.
- **Midstream**: implementation and pull request phase focused on code quality, security, and developer experience.
- **Downstream**: test/QA/release-prep phase. Verify coverage and resilience, and prevent regressions. Ensure AI review aligns with release readiness.
- **Skill**: a YAML frontmatter + Markdown unit of review guidance executed by River Reviewer.
- **Stream Router**: logic that selects and runs skills based on the requested phase and change context.
- **Riverbed Memory (Future)**: persistent context layer for previous findings, ADR references, and WontFix decisions to keep reviews consistent over time.
