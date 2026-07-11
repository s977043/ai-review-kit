# AGENT_LEARNINGS.md — River Review

## Purpose

- Store durable, reusable repo-specific learnings for future agents.
- Keep this file focused on facts that help across branches and sessions.

## Write Rules

- Add only stable observations that have been verified in the repository.
- Capture one learning per bullet with enough context to reuse it.
- Record secrets, personal data, transient debugging notes, and branch-specific TODOs nowhere in this file.
- Prefer facts that change slowly: command shapes, package boundaries, validation rules, source-of-truth files, and recurring pitfalls.
- Do not duplicate facts already stated in `AGENTS.md`. Only record what is not obvious from the canonical instructions.
- Remove or update entries when the underlying fact changes. Review during major refactors.

## Entry Format

- `YYYY-MM-DD`: short learning statement.
- `Applies to`: where the learning matters.
- `Evidence`: file or command that confirmed it.

## Current Learnings

- `2026-04-03`: LLM feature guards use `isLlmEnabled()` from `src/lib/utils.mjs`. It checks both OpenAI (`OPENAI_API_KEY`, `RIVER_OPENAI_API_KEY`) and Google Gemini (`GOOGLE_API_KEY`) keys.
  - `Applies to`: any code that conditionally enables LLM-powered features.
  - `Evidence`: `src/lib/utils.mjs`, `src/lib/local-runner.mjs`, `src/core/skill-dispatcher.mjs`.
- `2026-04-03`: Use Git Worktrees for parallel agent tasks. Setup and teardown steps are documented in `docs/runbook/dev.md` § 並行タスク。
  - `Applies to`: concurrent branch work and multi-agent workflows.
  - `Evidence`: `docs/runbook/dev.md`「並行タスク（Git Worktree）」セクション。
- `2026-04-30`: Suppression matching is keyed by **fingerprint** (file + issue pattern hash), not by message text. Severity `major` / `critical` only auto-suppress when the entry sets `feedbackType: accepted_risk`; lower severities pass through automatically. The hard-coded `HIGH_SEVERITY` set in `suppression-apply.mjs` is the P1 guard that protects against silently dropping security/risk findings.
  - `Applies to`: any change to suppression policy, fingerprint stability, or feedback-loop UX.
  - `Evidence`: `src/lib/finding-factory.mjs` (`annotateFingerprints`), `src/lib/suppression-apply.mjs`, `schemas/suppression-context.schema.json`, `pages/guides/repo-wide-review.md` "false positive suppression" section.
- `2026-04-30`: Context budgets are tuned via three knobs that all apply simultaneously: `maxTokens` (256–64000), `maxChars` (1024–200000), and per-section caps (`fullFile` / `tests` / `usages` / `config`). The collector takes `Math.min` across all of them. `reviewMode: tiny | medium | large` selects a preset (1024 / 4000 / 16000 max tokens) only when `context.budget` is omitted; an explicit `budget` always wins. The token estimator is a CJK-aware heuristic with a safe upper bound (chars/2), not a real tokenizer.
  - `Applies to`: tuning prompt size, debugging "context too small" reports, choosing reviewMode for new model classes.
  - `Evidence`: `src/lib/context-presets.mjs`, `src/lib/token-estimator.mjs`, `src/lib/repo-context.mjs` budget computation.
- `2026-04-30`: Secret redaction is **multi-stage** by design. Deny-glob runs BEFORE files are read (`.env*` / `*.pem` / `*.key` / `secrets.*` never enter process memory). Content-level redaction runs AFTER read with named categories plus an entropy fallback (default 4.5 bits / char, 24-char minimum). Replacements use length-stable `<REDACTED:category>` so suppression fingerprints stay deterministic across redaction. Final boundary redaction in `review-engine.mjs` covers prompt previews and debug output. Allowlist is for fixed test fixtures only.
  - `Applies to`: any change touching repo-wide context, prompt construction, or debug observability.
  - `Evidence`: `src/lib/secret-redactor.mjs`, wiring at `src/lib/repo-context.mjs` / `local-runner.mjs` / `review-engine.mjs`, `pages/guides/repo-wide-review.md` "secret redaction" section.

- `2026-05-03`: Root scripts assume Node.js `22.x`; running validations on older Node versions can fail before repo logic executes.
  - `Applies to`: local/CI execution of `npm run lint`, `npm test`, and validation scripts.
  - `Evidence`: `package.json` `engines.node` is pinned to `22.x`.

- `2026-05-24`: release-please often leaves a PR in `mergeStateStatus: BLOCKED` because the required CI checks did not register on the auto-generated branch (only `Vercel` appears). Fix: advance the branch by one empty commit. When local `git push` is unavailable (e.g. macOS Full Disk Access revoked the working tree), do it entirely via the gh REST API:

  ```bash
  REPO=s977043/river-review
  BRANCH=release-please--branches--main--components--river-review
  PARENT=$(gh api repos/$REPO/git/refs/heads/$BRANCH --jq '.object.sha')
  TREE=$(gh api repos/$REPO/git/commits/$PARENT --jq '.tree.sha')

  NEW=$(gh api repos/$REPO/git/commits --method POST --input - <<EOF | jq -r .sha
  { "message": "chore: trigger CI", "tree": "$TREE", "parents": ["$PARENT"] }
  EOF
  )

  gh api -X PATCH repos/$REPO/git/refs/heads/$BRANCH --input - <<EOF
  { "sha": "$NEW" }
  EOF
  ```

  Once the ref advances, the required status checks re-register and the PR transitions BLOCKED → CLEAN.
  - `Applies to`: release-please workflow recovery, fs-loss / sandbox-restricted environments, any case where the branch head must advance without a local checkout.
  - `Evidence`: validated on PR #876 (v0.53.0) during a session where the working tree was inaccessible; the BLOCKED → CLEAN → squash-merge → release-publish flow completed entirely via gh API.

- `2026-07-09`: `git commit --no-verify` skips the lint-staged pre-commit hooks, including the `skills/**/*.md` step that runs `npm run skills:manifest && git add docs/data/skill-manifest.json`. Committing skill-doc edits with `--no-verify` therefore leaves `docs/data/skill-manifest.json` stale, and the CI `Skill schema validation` job (`skills:manifest:check`) fails with "skill manifest is stale". After editing `skills/**/*.md`, either commit without `--no-verify`, or run `npm run skills:manifest` and stage `docs/data/skill-manifest.json` in the same commit. The same bypass also drops `check:dashes` / `prettier --write` / `markdownlint --fix` on `**/*.md` and `textlint --no-cache` on `pages/**`.
  - `Applies to`: any commit that edits `skills/**/*.md` (especially `skills/agent-skills/**`) and uses `--no-verify`.
  - `Evidence`: `.lintstagedrc.json` `skills/**/*.md` block; PR #1447's first commit failed CI `Skill schema validation`, fixed by regenerating the manifest in the second commit.

- `2026-07-11`: When a review bot's comment claims a reproducible behavior change (a crash, a wrong output, a missed detection), attempt the reproduction before dismissing the comment on consistency/convention grounds. Consistency-based skips are valid only for comments that make no behavior claim (link style, vocabulary, formatting).
  - `Applies to`: triaging gemini/Codex review-bot comments on PRs, especially "consistency" or "convention" dismissals.
  - `Evidence`: gemini flagged the `realpathSync` ENOENT crash in 5 comments across #1475/#1479; the skips cited "canonical-form consistency", then Codex reproduced the crash (`printf "import '<script>';" | node --input-type=module -`) proving a real import-time regression, fixed in #1483.

- `2026-07-11`: Four techniques proven during the #1473 refactor wave (all merged with zero behavioral regressions in CI) go beyond "the tests still pass" when verifying a behavior-invariant refactor: (a) extract the pre-change function body from real source text into a standalone snapshot module and byte-diff its outputs across all inputs (used for the 18-kind message switch in #1480); (b) run the same CLI commands on a temp git repo before/after and byte-diff stderr/exit codes (#1477); (c) prove "not even imported when opted out" invariants with an injected import spy (#1478); (d) pin generated artifacts with `git diff --quiet` after regeneration (#1481).
  - `Applies to`: reviewing or authoring refactor PRs that claim behavior-invariance.
  - `Evidence`: #1473 (refactor wave issue); #1477, #1478, #1480, #1481 (merged PRs applying each technique).

- `2026-07-11`: The commit-msg hook (`@commitlint/config-conventional`) rejects subjects whose first token after the type is sentence-/start-/pascal-/upper-case — e.g. `docs: AGENTS.md の...` fails with `subject-case`. Start the subject with a lowercase word or Japanese text.
  - `Applies to`: any `git commit` on this repo, especially docs commits that would otherwise start with a proper noun or filename.
  - `Evidence`: masked historically by `--no-verify` usage (see the 2026-07-09 entry above); observed on #1450's fix commit.
