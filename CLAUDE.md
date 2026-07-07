# Claude Code Project Guide (river-review)

> **Repo rules**: Follow all sections in [AGENTS.md](./AGENTS.md). This file adds only Claude Code-specific work policy.

<!-- Maintenance: repo-wide rules belong in AGENTS.md.
     Only Claude Code behavior policy belongs here.
     Never restate AGENTS.md content. -->

## Decision Policy

- **Proceed autonomously**: read-only exploration, running commands listed in `.claude/settings.json` allow list, editing paths in AGENTS.md "Editable" scope.
- **Ask before acting**: editing paths in AGENTS.md "Ask before editing" scope, adding dependencies, running commands not in allow list.
- **Always ask**: architectural changes, modifying AGENTS.md or CLAUDE.md, any destructive git operation, changes touching `src/` that may break skill or schema alignment.

## Change Policy

- One logical change per branch. Do not bundle unrelated fixes.
- Minimal diff — do not refactor, reformat, or annotate code outside the task scope.
- Do not add features, patterns, or dependencies not explicitly requested.
- If a task seems too large for one session, propose a plan and get approval first.

## Reporting

After completing a task, state concisely:

1. What changed (files and purpose).
2. What was verified (commands run and results).
3. What needs human review (assumptions, edge cases, "ask before" paths touched).

If a check fails, show the failure output and proposed fix before applying.

## AI Misoperation Guards

- **Read before referencing**: Do not cite file contents, function names, or line numbers without first reading the file.
- **Run before claiming**: Do not assert that tests pass or lint succeeds without running the command and showing output.
- **No silent skips**: If a required validation fails, report it — do not silently omit it from the report.
- **Search before inventing**: When uncertain about a convention, search `skills/`, `docs/`, and existing code before creating a new pattern.
- **Diff only what exists**: In reviews, do not comment on code that is not in the diff.
- **Research before proposing**: Do not create GitHub issues without first confirming the feature is not already implemented. See `/propose-issue`.
- **Propagate signatures**: When adding parameters to pipeline functions (`generateReview`, `verifyFinding`, `buildExecutionPlan`), consult `docs/development/pipeline-params-checklist.md` to avoid call-site gaps.
- **Plan merge order**: When creating multiple PRs that touch overlapping files, run `/plan-merge-order` before merging to minimize rebase cost.
- **Commit before branch switches**: Before `git checkout`/`git switch` with uncommitted work, create a throwaway safety commit on a new branch: `git switch -c wip/<topic> && git add -A && git commit -m "wip" --no-verify`. Stash-then-switch chains have lost work when combined with the lint-staged auto-stash. Does not authorize `git stash drop`, `git reset --hard`, or `git push --force` — those remain prohibited per AGENTS.md Safety.
- **Verify git output before chaining**: Extends **Run before claiming**. After `git commit`, `git push`, `git switch`, and `gh pr merge`, read the branch name, commit hash, and status line in the output and confirm they match the intended target before running the next command. Verify with `git status -sb` or `git rev-parse --abbrev-ref HEAD` if the output is ambiguous.
- **Verify gh active account before write ops**: The local `gh` keyring holds two accounts (`s977043` for this repo, `kominem-unilabo` for work), and the active account silently switches to `kominem-unilabo` mid-session — observed 5+ times in the 2026-06-10..11 session, causing `404 Not Found` / `must be a collaborator` / `does not have the correct permissions` on `gh pr create` / `gh pr merge` / `gh api .../update-branch` / `gh issue create`. Before every `gh` write op, guard with: `gh api user --jq .login | grep -q s977043 || gh auth switch -u s977043`. Treat a 404/permission error on any `gh` write as account-switch first, not a real permission problem. This guard is automated by a PreToolUse hook (`.claude/hooks/gh-account-guard.sh`), but the hook is defense-in-depth — keep the session-start account check.
- **Merge-time checks**: Before `gh pr merge`, work through the checklist in `docs/governance.md` § "PR レビューとマージ" > "マージ前チェックリスト" — CI green (`gh pr checks`), line-level reviewer comments disposition (`gh api --paginate 'repos/:owner/:repo/pulls/<N>/comments?per_page=100'`), `/preflight` for multi-PR / workflow-pin work, and `.nvmrc`-matched `npm run build:action` when touching `runners/github-action/src/**`. That section is the SSoT for exact commands, pagination pitfalls, and disposition rules; do not duplicate them here. See also `skills/midstream/gh-address-comments/SKILL.md` for the reviewee-side comment-handling workflow and `docs/development/dist-check-rebuild-guide.md` for dist rebuild troubleshooting.
- **Strict-mode batch merge**: When merging N independent PRs against a branch protected with `strict: true` (check via `gh api repos/OWNER/REPO/branches/main/protection --jq .required_status_checks.strict`), rebase ALL remaining branches onto the same `origin/main` SHA simultaneously before starting the chain, then merge one-by-one immediately after each CI passes. Rebasing one-at-a-time after each individual merge re-triggers full CI for every remaining PR and multiplies total wait time by N. For lock-file-only conflicts where `gh api .../update-branch` returns 422: resolve locally with `npm install --package-lock-only` and force-push the original branch — do not create a new PR, as that discards CI history and review metadata.
- **Dep bump peerDeps check**: After editing `package.json` to bump a package version, run `npm install --dry-run` (or `npm ls --depth=1` post-install) to surface newly required peer deps, including transitive ones that `npm info peerDependencies` misses. Add missing peers to `package.json` in the same commit to avoid build failures on first CI run.
- **Doc-edit textlint**: After editing Japanese docs (`pages/**`, `docs/**`, `README*.md`), verify with `npx textlint --no-cache <files>` before committing — `npm run lint:text` reuses a cache that can mask new violations, so the Lint job fails in CI even when the local cached run passed. The recurring textlint rules: body sentences use ですます調 but list items use である調; each sentence ≤150 chars; do not repeat the same particle (は/が/を/に/で/も …) twice in one sentence. Run `npm run fix:dashes` in the same pass. The pre-commit lint-staged now also runs `textlint --no-cache` on staged `pages/**/*.md`; keep the manual check as defense-in-depth (it also covers `docs/**` and `README*.md`).
- **Doc-link relativity (lychee)**: In `pages/**` use **relative `.md` links** (e.g. `../../guides/add-new-skill.md`), not root-relative `/guides/...` — lychee cannot resolve root-relative local links and fails the Link Check job (`Cannot convert path '/...' to a URI`). Match the existing relative-link convention; verify by reading the lychee-report artifact on failure (#1194).
- **Review-doc SSoT sync**: `docs/review/viewpoints.md` and `docs/review/output-format.md` declare `pages/reference/review-policy.md` (ja+en) as their 出典/source. When changing review criteria, output sections, or severity vocabulary in the derived docs, update `review-policy.md` (both languages) in the same PR — otherwise the derived docs drift from the SSoT (#1196/#1197).
- **Plugin bundle mirror**: When adding or updating fields in a distribution bundle (e.g. `awesome-codex-plugins` fork's `plugin.json`), apply the same change to the canonical manifest in this repo (`.codex-plugin/plugin.json`, `.claude-plugin/plugin.json`) in the same PR. Fields that diverge between the bundle and the repo are not covered by `npm run plugin:sync` and will silently drift. Run `npm run plugin:validate` to catch asset-path and parity errors before pushing (#1250).
- **Skill-check fixture/description drift**: When adding, removing, or renaming a Check section in `skills/upstream/ai-agent-review-readiness/SKILL.md` (or any skill that uses embedded `<!-- expected: -->` blocks in its fixtures), update the following in the same commit: (1) each `fixtures/*.md` — confirm that the `<!-- expected: -->` block reflects the new Check; for fixtures that expect `findings: []`, add a section that satisfies the new Check so the expectation remains valid; (2) the frontmatter `description` field — verify it enumerates all current Checks so downstream consumers and bot reviewers see a complete list.
- **Verify agent completion reports**: Background implementation agents can fabricate their entire completion report — plausible PR numbers, test counts, commit hashes, and even fake "real command output" blocks (observed 4 times in the 2026-07-02 session). Report quality is NOT evidence of execution. Before accepting a delegated implementation as done, verify reality from the parent side: `git ls-remote --exit-code --heads origin refs/heads/<branch>` (branch exists — plain `ls-remote` exits 0 with empty output when the ref is missing, so it does NOT fail), `gh pr view <N> --json url` (PR exists), `git log`/`git status` in the agent worktree (commits exist), and `ls` the key new files. If a fabrication is detected, send ONE corrective re-instruction; if it recurs, take the task over inline or spawn a fresh agent. Read-only review/research agents did not exhibit this failure mode. Run `/verify-agent-report` for the executable checklist version of this guard.
- **Worktree-held branches refuse switch**: `git switch <branch>` fails when that branch is checked out in any worktree (including agent worktrees under `.claude/worktrees/`), and with `2>/dev/null` the failure is silent — subsequent `git reset` / commits then land on whatever branch was current (observed: commits landing on local main, recovered because origin/main was untouched). Extends "Verify git output before chaining": after EVERY `git switch`, confirm with `git rev-parse --abbrev-ref HEAD` before running state-changing git commands, and check `git worktree list` before manipulating a branch an agent may hold.
- **`N of N required checks are expected` = bot/GITHUB_TOKEN push**: When a PR shows all required checks green yet `gh pr merge` refuses with `N of N required status checks are expected` and `mergeStateStatus: BLOCKED`, the root cause is almost always that a bot (`auto-rebuild-action-dist`, release-please, etc.) pushed the current head using `GITHUB_TOKEN`; GitHub's no-recursion safety leaves that head's workflows `action_required` (never run), so the required contexts stay unreported. Diagnose: `git fetch` and confirm the PR head SHA matches YOUR last push (`gh pr view <N> --json headRefOid --jq .headRefOid`, or GraphQL `pullRequest.headRefOid` — NOT `commits.nodes[0]`, which returns the FIRST commit); if it drifted and the new head's `gh run list` shows `action_required`, this is it. Escape without force-push: take the bot commit in with `git merge --ff-only origin/<branch>`, then push an empty commit (or a `git merge origin/main`) **from your own account** so CI fires as a real user — never `git reset --hard` or `git push --force`. For release-please PRs, `scripts/release-please-kick.sh` / the `Release Please Kick` workflow do the same (they need `RELEASE_KICK_PAT`). `gh pr merge --admin` cannot bypass this when `enforce_admins: true`; the `POST actions/runs/{id}/approve` endpoint is fork-PR-only (403 otherwise). See memory `dist-bot-approval-gate-escape` and `docs/runbook/release-please-kick.md`.
- **CI matrix leg ↔ branch-protection required-check sync**: A CI test-matrix leg (e.g. `node-version: [20.x, 22.x]`) whose job name is registered as a branch-protection required status check (e.g. `Unit tests (20.x)`) is COUPLED to that protection setting. Adding, removing, or renaming a leg without updating the required checks makes the old context never report — every future PR then hangs on `N of N required checks are expected` permanently. When changing a matrix leg, update branch protection FIRST, then merge the workflow change: `gh api -X PATCH repos/OWNER/REPO/branches/main/protection/required_status_checks` with the new `checks` array (drop the removed leg / add the new one; keep `app_id`). Order matters — protection-first avoids a window where all PRs block. Check `gh api repos/OWNER/REPO/rulesets` too; if a ruleset also lists required checks, update it in the same pass. Also reconcile `package.json` `engines.node` and any README "supported versions" statement.

## Improvement Flow

When a retrospective identifies a recurring mistake or missing guardrail, follow the codification process in `docs/development/improvement-flow.md`: retrospect → classify → draft → self-review → multi-agent review → PR → save memory. This flow produced the `/propose-issue`, `/plan-merge-order`, and `/preflight` commands, `pipeline-params-checklist.md`, `dist-check-rebuild-guide.md`, `heuristic-detector-checklist.md`, the AI Misoperation Guards "Research before proposing", "Propagate signatures", "Plan merge order", "Commit before branch switches", "Verify git output before chaining", "Doc-edit textlint", "Verify agent completion reports", "Worktree-held branches refuse switch", "`N of N required checks are expected` = bot/GITHUB_TOKEN push", and "CI matrix leg ↔ branch-protection required-check sync", and the `docs/governance.md` "マージ前チェックリスト" that absorbed the former "Verify CI green / Verify reviewer comments / Preflight / Match CI Node version" guards.

## Tooling

| Component   | Location                  | Behavior                                                              |
| ----------- | ------------------------- | --------------------------------------------------------------------- |
| Permissions | `.claude/settings.json`   | Defines allow/ask/deny command lists                                  |
| Rules       | `.claude/rules/`          | Auto-loaded by glob pattern in frontmatter (e.g., `**/*`)             |
| Hooks       | `.claude/hooks/format.sh` | PostToolUse: auto-runs prettier on all changed files (vs HEAD)        |
| Sub-agent   | `agents/river-review.md`  | Distributed plugin agent (top-level per #996); Read, Grep, Glob, Bash |

## Custom Commands

| Command                | Purpose                                                                 |
| ---------------------- | ----------------------------------------------------------------------- |
| `/check`               | Run quality checks (lint + test)                                        |
| `/pr`                  | Draft PR description                                                    |
| `/skill`               | Find or create skill definition                                         |
| `/review-local`        | Self-review current diff                                                |
| `/challenge`           | Adversarial review (pre-mortem, war game)                               |
| `/propose-issue`       | Research codebase before creating an issue                              |
| `/plan-merge-order`    | Plan merge order for multiple PRs to minimize rebase cost               |
| `/preflight`           | Verify tasks are not obsolete or in parallel before work                |
| `/verify-agent-report` | Verify agent completion reports against real branches, PRs, and commits |
| `/merge-check`         | Run the pre-merge checklist (docs/governance.md) against a PR number    |

Details: distributed commands (`/check` `/pr` `/skill` `/review-local` `/challenge`) live in top-level `commands/` (plugin surface, per #996); repo-dev commands (`/propose-issue` `/plan-merge-order` `/preflight` `/verify-agent-report` `/merge-check`) stay in `.claude/commands/`.

> Note: the distributed commands resolve only when river-review is **installed as a plugin**. When working inside this repo directly, Claude Code auto-discovers project commands from `.claude/commands/` only — so the five distributed commands are not available as in-repo slash commands (the repo-dev commands are).
