# Thank you for contributing to River Reviewer

Thank you for taking the time to make this project better. We welcome bug reports, feature ideas, and documentation improvements.
The Japanese guide in `CONTRIBUTING.md` is the source of truth; this English copy is best-effort.

## ⚖️ Code of Conduct

We aim for an open, welcoming community. Please follow our [Code of Conduct](CODE_OF_CONDUCT.md) when you participate.

## 💡 Ways to contribute

### ✅ Before opening an issue

- Search existing issues (open/closed) to avoid duplicates
- Check docs (`README.md` and `pages/`) for existing answers or policies
- If this may be a security issue, do not open a public issue; follow `SECURITY.md` to report it privately

Use the issue templates via `Issues → New issue` (or [issues/new/choose](https://github.com/s977043/river-reviewer/issues/new/choose)).

### 🗂️ Issue types (rough guide)

- Bug: unexpected behavior, exceptions, incorrect output
- Feature/Enhancement: new capability or improvement (skills, CLI/Action/Docs, etc.)
- Task: concrete work item (roadmap, ops, refactors)
- Documentation: add/fix docs
- Question: ask/discuss (consider Discussions for lightweight topics)

### 🐞 Bug reports

If you find a bug, open an issue with:

- **Summary**: What's wrong?
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
4. Run local checks (at least `npm test` and `npm run lint`).
5. **Push** the branch to GitHub (`git push origin feature/your-feature-name`).
6. Open a pull request and follow the PR template to describe your changes.

Smaller, focused PRs are ideal.

### ✅ Local checks (recommended)

```bash
npm test
npm run lint
```

Depending on what you change:

- If you changed skills (`skills/`): `npm run skills:validate`
- If you changed agent definitions: `npm run agents:validate`
- If you changed tracing functionality: `npm run trace:validate` (when OpenTelemetry validation is needed)

### 📎 Related docs

- Commit summary (JA): `docs/contributing/commit-summary.ja.md`
- Review checklist: `docs/contributing/review-checklist.md`

### 🧭 Coding/ops conventions (summary)

- JS/Node uses ESM; tests use `node --test`
- Formatting is enforced by Prettier (checked via `npm run lint`)
- Do not commit secrets in `.env*` files; use dummy values in examples
- Doc site sources live under `pages/` (Docusaurus). The `docs/` directory is for internal/ops docs and may be referenced from `pages/`
- Do not hand-edit `package-lock.json`; update it by running `npm install` when you change dependencies in `package.json` (`npm ci` installs from the lock file)

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

- Place files under the right section (for example, `pages/tutorials/`, `pages/guides/`, `pages/reference/`, `pages/explanation/`). Add English copies in the same location with a `.en.md` suffix.
- State the chosen Diátaxis type in the PR title or description, for example:
  - Docs: Tutorial—Getting started with River Reviewer
  - Docs: How-to—Add a custom skill
  - Docs: Reference—GitHub Action inputs
  - Docs: Explanation—River flow model

## ✍️ Document style (dashes)

We standardize dash usage like this:

- Use an em dash (—) with **no spaces** for heading breaks or front-matter titles (example: `Part I—Overview`).
- Use an en dash (–) for numeric ranges (`0.0–1.0`).
- Don't automatically convert dashes inside code blocks or YAML structure.

Automation:

- The repository has a Node script `scripts/fix-dashes.mjs`. Run locally with `npm run fix:dashes`.
- CI and PRs use Vale (Prose Lint) with Microsoft Dashes rules. Run the linter locally before opening a PR.

## 📜 Attribution

This guide was inspired by the [contributing.md template](https://gist.github.com/PurpleBooth/b24679402957c63ec426) and [opensource.guide](https://opensource.guide/how-to-contribute/).
