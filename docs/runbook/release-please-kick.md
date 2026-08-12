# Release Please Kick Runbook

## When to use

The release-please PR is BLOCKED because required status checks were not
registered on the auto-generated branch (a common consequence of strict
branch protection on freshly created refs).

## Before you start: confirm the procedure is current

This runbook and `.claude/commands/release-kick.md` are revised often. A local
`main` that trails `origin` silently hands you a pre-revision copy. Check the
freshness of the procedure itself before any diagnosis below. Fetch `origin`,
diff both files against `origin/main`, and re-read them if either differs.
Step 0 of `.claude/commands/release-kick.md` holds the executable form.

Observed in the v1.67.1 run: the local checkout was 24 commits behind. The
pre-#1702 revision of the procedure was therefore the one actually read, even
though #1702 had merged 16 minutes before the kick.

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
| `0`         | pure BLOCKED     | kick (`scripts/release-please-kick.sh`)           | Yes                                   |

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

## The kick: local script

Run the script. It is the route that works on this repository today, and the
only one that needs no repository secret.

```bash
scripts/release-please-kick.sh
# or with explicit branch:
scripts/release-please-kick.sh release-please--branches--main--components--river-review
```

The script uses `gh api` to create an empty commit via the REST API
(`POST git/commits` + `PATCH git/refs/heads/...`). It authenticates with your own
`gh` credentials, so the new head counts as a real user push and re-fires
`pull_request` workflows. It also works without a clean local checkout, which is
useful during `fs-loss` incidents.

## The `Release Please Kick` workflow is not an equivalent alternative

`.github/workflows/release-please-kick.yml` performs the same empty-commit kick
from the Actions tab. It works only where the `RELEASE_KICK_PAT` secret is
registered. GitHub blocks `GITHUB_TOKEN`-authored pushes from triggering
`pull_request: synchronize` workflows (no-recursion safety). Without the secret,
the workflow's own push therefore unblocks nothing, and the run fails with an
error pointing back to this runbook (#906).

Check whether the secret exists before choosing this route:

```bash
gh api repos/:owner/:repo/actions/secrets --jq '.secrets[].name'
```

On this repository the call currently returns nothing: no Actions secret is
registered. The workflow route is therefore unavailable, and the script above is
the procedure to use. The workflow last succeeded on 2026-05-25. Every run since
then has failed at the `Verify downstream CI actually started` step for this
reason. The workflow is **deprecated** (refs #1800): it is in the first stage of
a "deprecate → observe → delete" plan, and its name carries a `[DEPRECATED]`
prefix. The file will be deleted after the observation period unless a
maintainer registers the secret and re-adopts the workflow.

### Setup (one-time, only to enable the workflow route)

1. Create a fine-grained PAT with **Contents: Read and write** on this repo.
   (Or use a GitHub App installation token if you prefer.)
2. Add it as repo secret `RELEASE_KICK_PAT` under **Settings → Secrets and variables → Actions**.
3. The workflow auto-detects the secret. Without it, the workflow exits 1 with a clear error
   pointing back to this runbook.

Adding the secret is a human-only operation that an agent session cannot
perform. Treat the local script as the standing procedure until a maintainer
completes this setup.

### Running it once the secret exists

1. Confirm the `RELEASE_KICK_PAT` secret is configured (above).
2. Go to **Actions → Release Please Kick → Run workflow**.
3. Leave `branch` blank—the workflow auto-detects the open release-please PR.
4. The workflow also verifies a non-Vercel check started within 90s; if not, it fails loudly
   so the silent #906 failure mode cannot recur.

## Background

See `docs/development/retrospectives/2026-05-21-25.md` (W1+W5). The empty-commit
pattern is recorded in `AGENT_LEARNINGS.md` (2026-05-24 entry).

## Related

`.claude/commands/release-kick.md` turns this runbook into an end-to-end
procedure (unblock, merge, verify the release). This runbook stays the SSoT for
the BLOCKED cause, the BEHIND decision, which kick route to use, and
`RELEASE_KICK_PAT` setup. Fix the command when the two disagree.
