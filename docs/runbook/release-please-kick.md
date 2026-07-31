# Release Please Kick Runbook

## When to use

The release-please PR is BLOCKED because required status checks were not
registered on the auto-generated branch (a common consequence of strict
branch protection on freshly created refs).

## First: diagnose BEHIND vs pure BLOCKED

A release PR can be behind `main` and BLOCKED at the same time, and which one it
is decides whether the kick is needed at all. `mergeable_state` holds a single
value, so it cannot tell the two apart. Compare the branches instead:

```bash
releaseBranch=$(gh pr view <N> --json headRefName --jq .headRefName)
gh api "repos/:owner/:repo/compare/main...$releaseBranch" --jq '{status, ahead_by, behind_by}'
```

| `behind_by` | State            | First action                                      | Kick still needed                     |
| ----------- | ---------------- | ------------------------------------------------- | ------------------------------------- |
| `> 0`       | BEHIND + BLOCKED | `PUT /repos/:owner/:repo/pulls/<N>/update-branch` | No, once the new head's workflows run |
| `0`         | pure BLOCKED     | kick (`workflow_dispatch` or the local script)    | Yes                                   |

When `behind_by > 0`, run `update-branch` first. The merge commit it creates is
pushed with your own account's token, not the bot token. The no-recursion safety
therefore does not apply, and the workflows fire as a real user push. That makes
the empty-commit kick unnecessary, saving one commit and one CI round.

When `behind_by == 0`, `update-branch` has nothing to merge and returns HTTP 422.
The kick is then the only way forward.

Either way, confirm the new head before moving on:

```bash
gh run list --limit 5 --json databaseId,status,conclusion,headBranch,workflowName
```

If the runs sit at `action_required`, the push did not count as a real user push.
Fall back to the kick below.

### Evidence

- **v1.66.1** (PR #1693): BEHIND + BLOCKED. `update-branch` alone fired every
  workflow, so the empty-commit kick was skipped.
- **v1.67.0** (PR #1699): `ahead_by: 1, behind_by: 0` right after release-please
  opened the PR. `update-branch` did not apply, and the kick was the correct move.

## Setup (one-time): `RELEASE_KICK_PAT` secret

The workflow requires a Personal Access Token to actually unblock downstream CI.
GitHub blocks `GITHUB_TOKEN`-authored pushes from triggering `pull_request: synchronize`
workflows (no-recursion safety), so the default token cannot do this job (#906).

1. Create a fine-grained PAT with **Contents: Read and write** on this repo.
   (Or use a GitHub App installation token if you prefer.)
2. Add it as repo secret `RELEASE_KICK_PAT` under **Settings → Secrets and variables → Actions**.
3. The workflow auto-detects the secret. Without it, the workflow exits 1 with a clear error
   pointing back to this runbook.

## Preferred: `workflow_dispatch`

1. Confirm `RELEASE_KICK_PAT` secret is configured (above).
2. Go to **Actions → Release Please Kick → Run workflow**.
3. Leave `branch` blank—the workflow auto-detects the open release-please PR.
4. The workflow also verifies a non-Vercel check started within 90s; if not, it fails loudly
   so the silent #906 failure mode cannot recur.

## Fallback: local script

```bash
scripts/release-please-kick.sh
# or with explicit branch:
scripts/release-please-kick.sh release-please--branches--main--components--river-review
```

The script uses `gh api` to create an empty commit via the REST API
(`POST git/commits` + `PATCH git/refs/heads/...`). It works without a clean
local checkout, which is useful during `fs-loss` incidents.

## Background

See `docs/development/retrospectives/2026-05-21-25.md` (W1+W5). The empty-commit
pattern is recorded in `AGENT_LEARNINGS.md` (2026-05-24 entry).

## Related

`.claude/commands/release-kick.md` turns this runbook into an end-to-end
procedure (unblock, merge, verify the release). This runbook stays the SSoT for
the BLOCKED cause, the BEHIND decision, `RELEASE_KICK_PAT` setup, and the
`workflow_dispatch` alternative. Fix the command when the two disagree.
