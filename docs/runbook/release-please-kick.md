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

### A run count of zero is never the diagnosis

Judge a head by the `conclusion` of its runs, not by how many the query returns.
Zero is ambiguous, and it misleads at both ends of a PR's life:

- **Right after the PR opens**, the runs may not be registered yet. In the
  v1.89.1 run, `gh run list --commit <head>` returned 0 about a minute after
  release-please opened #1986, and that was reported as "no workflow fired".
  Re-measured roughly 40 minutes later, the same head carried 13 runs. The
  conclusion (stalled, kick required) held, but the number it was argued from
  did not.
- **After the merge**, the head is gone and the record no longer reads the same
  way. Run this diagnosis while the PR is still open, as the guard in
  `CLAUDE.md` requires.
- **An abbreviated SHA silently returns zero.** The `head_sha` filter matches
  the full 40-character SHA only. Measured on 2026-08-28,
  `head_sha=fc3d6f7f` returned `total_count: 0` while
  `head_sha=fc3d6f7f4ccbee2651437835ca54bc2a63ae7f2d` returned 13. Expand the
  SHA before reading anything into a zero.

Read the conclusions instead of the count:

```bash
gh api "repos/:owner/:repo/actions/runs?head_sha=<full-40-char-sha>&per_page=100" \
  --jq '.workflow_runs[] | "\(.name)\t\(.status)\t\(.conclusion)"'
```

A column of `action_required` means the head is stalled and the kick applies. A
column of `success` means the push counted as a real user push.

Take a positive control in the same pass: run the identical query against a SHA
whose CI is known to have executed, and confirm it returns rows. On 2026-08-28,
`26bc1c7929bc56c80684abe93383d0bb3f214736` (the `main` tip before the v1.89.1
release PR) returned 7 runs, all `success`. When the control also returns zero,
the query is wrong rather than the head.

### Evidence

- **v1.66.1** (PR #1693): BEHIND + BLOCKED. `update-branch` alone fired every
  workflow, so the empty-commit kick was skipped.
- **v1.67.0** (PR #1699): `ahead_by: 1, behind_by: 0` right after release-please
  opened the PR. `update-branch` did not apply, and the kick was the correct move.
- **v1.89.1** (PR #1986): `ahead_by: 1, behind_by: 0`, so pure BLOCKED and the
  same shape as v1.67.0—`update-branch` returns 422 and the kick is the only
  route. `scripts/release-please-kick.sh` moved the head from `fc3d6f7f` to
  `72227d02`. That new head carries 13 runs that actually executed (11
  `success`, 2 `skipped`), all 7 required contexts reported, and the PR merged
  as `b09af847`. The stalled runs on the old head do not stay readable after the
  branch is deleted: re-measured post-merge, `fc3d6f7f` reports `completed` /
  `failure` (updated `2026-08-28T03:55:47Z`) rather than `action_required`,
  which is one more reason to diagnose while the PR is open.

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
2. Go to **Actions → [DEPRECATED] Release Please Kick → Run workflow**.
3. Leave `branch` blank—the workflow auto-detects the open release-please PR.
4. The workflow also verifies a non-Vercel check started within 90s; if not, it fails loudly
   so the silent #906 failure mode cannot recur.

## After the merge: verify the `v1` alias, not just the tag

A release is not verified by the version tag alone. Action consumers pin `@v1`,
so `v1` is the ref that decides what they actually run.

Measured immediately after the #1986 merge, `v1` still pointed at `23302f06`,
the v1.89.0 commit. The alias is moved by the **"Update major alias tag"** step
of the `Release Please` workflow on `main`, and that run has to finish before
the alias means anything. Wait for it, then re-measure:

```bash
git fetch origin --tags --force --prune
git rev-parse v1^{commit}
git rev-parse v1.89.1^{commit}
```

Once the workflow completed, both returned
`b09af8479c4140fe0d9f584794322548bc059c25`. Treat a mismatch as an unfinished
release rather than a tagging quirk.

## Background

See `docs/development/retrospectives/2026-05-21-25.md` (W1+W5). The empty-commit
pattern is recorded in `AGENT_LEARNINGS.md` (2026-05-24 entry).

## Related

`.claude/commands/release-kick.md` turns this runbook into an end-to-end
procedure (unblock, merge, verify the release). This runbook stays the SSoT for
the BLOCKED cause, the BEHIND decision, which kick route to use, and
`RELEASE_KICK_PAT` setup. Fix the command when the two disagree.
