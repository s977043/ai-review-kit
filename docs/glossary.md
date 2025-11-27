# River Reviewer Glossary

- **Upstream**: requirements, design, and architecture phase (including ADRs) where early review prevents costly rework.
- **Midstream**: implementation and pull request phase focused on code quality, security, and developer experience.
- **Downstream**: test, QA, and release-prep phase to verify coverage, resilience, and regression protection.
- **Skill**: a YAML frontmatter + Markdown unit of review guidance executed by River Reviewer.
- **Stream Router**: logic that selects and runs skills based on the requested phase and change context.
- **Riverbed Memory (Future)**: persistent context layer for previous findings, ADR references, and WontFix decisions to keep reviews consistent over time.
