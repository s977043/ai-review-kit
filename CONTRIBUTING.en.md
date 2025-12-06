# Thank you for contributing to River Reviewer

Thank you for taking the time to make this project better. We welcome bug reports, feature ideas, and documentation improvements.
The Japanese guide in `CONTRIBUTING.md` is the source of truth; this English copy is best-effort.

## ⚖️ Code of Conduct

We aim for an open, welcoming community. Please follow our [Code of Conduct](CODE_OF_CONDUCT.md) when you participate.

## 💡 Ways to contribute

### 🐞 Bug reports

If you find a bug, open an issue with:

- **Summary**: What is wrong?
- **Reproduction steps**: Concrete steps so others can reproduce it.
- **Expected behavior**: What you thought would happen.
- **Actual behavior**: What actually happened.

### ✨ Feature proposals

For new checklist items or agent ideas, open an issue with:

- **Clear title**: So the idea is recognizable.
- **Background**: Why this is needed and what problem it solves.

### 📝 Pull request process

1. **Fork** this repository.
2. Clone locally and **create a branch** (`git checkout -b feature/your-feature-name`).
3. Make your changes and commit with a clear message.
4. **Push** the branch to GitHub (`git push origin feature/your-feature-name`).
5. Open a pull request and follow the PR template to describe your changes.

Smaller, focused PRs are ideal.

## 📚 Documentation contributions

River Reviewer docs follow the [Diátaxis documentation framework](https://diataxis.fr/). Choose one type and write to that shape. Japanese (`.md`) is the source of truth; English copies use the same name with `.en.md` and are maintained on a best-effort basis. If content diverges, prefer the Japanese version.

- Tutorial—learning-oriented, step-by-step guides to get new users to a first success.  
  Example: "First steps with River Reviewer on GitHub Actions"

- How-to guide—recipes for achieving a specific goal; the reader already knows the basics.  
  Example: "Add a custom review skill" / "Run River Reviewer locally"

- Reference—accurate, as-complete-as-possible lists of APIs, settings, and schemas.  
  Example: "GitHub Action inputs" / "skill YAML schema"

- Explanation—background, design decisions, and concepts.  
  Example: "Upstream/midstream/downstream model" / "Design principles of River Reviewer"

To keep reviews smooth:

- Place files under the right section (e.g., `pages/tutorials/`, `pages/guides/`, `pages/reference/`, `pages/explanation/`). Add English copies in the same location with a `.en.md` suffix.
- State the chosen Diátaxis type in the PR title or description, e.g.:
  - Docs: Tutorial—Getting started with River Reviewer
  - Docs: How-to—Add a custom skill
  - Docs: Reference—GitHub Action inputs
  - Docs: Explanation—River flow model

## ✍️ Document style (dashes)

We standardize dash usage like this:

- Use an em dash (—) with **no spaces** for heading breaks or front-matter titles (example: `Part I—Overview`).
- Use an en dash (–) for numeric ranges (`0.0–1.0`).
- Do not auto-convert dashes inside code blocks or YAML structure.

Automation:

- The repository has a Node script `scripts/fix-dashes.mjs`. Run locally with `npm run fix:dashes`.
- CI and PRs use Vale (Prose Lint) with Microsoft Dashes rules. Run the linter locally before opening a PR.

## 📜 Attribution

This guide was inspired by the [contributing.md template](https://gist.github.com/PurpleBooth/b24679402957c63ec426) and [opensource.guide](https://opensource.guide/how-to-contribute/).
