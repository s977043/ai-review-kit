# Adopter Playbook (Integration modes and staged rollout)

When you bring River Review into a new repository or team, the hardest part is often not the features themselves but the early operational decisions: which integration path to use, where to start gating, and how to promote review viewpoints into your own skills. This how-to collects those early decisions.

This guide focuses on early-adoption judgment. For the concrete setup steps of each path, see the dedicated guides ([GitHub Actions](./github-actions.en.md) / [Using Skill Packs](./use-skill-packs.en.md) / [Two-stage review gate](./two-stage-review-gate.en.md)).

## 1. Choose an integration mode

River Review is not a single integration path; there are several depending on your goal. Note that **which path reads `.river-review.json` differs per path**.

| Mode                           | What it means                                                                          |                      Reads `.river-review.json`?                      | Recommended for                                                |
| ------------------------------ | -------------------------------------------------------------------------------------- | :-------------------------------------------------------------------: | -------------------------------------------------------------- |
| GitHub Actions                 | Run the River Review runner in CI                                                      |                 Yes (runner reads it from repo root)                  | Automated review at PR time                                    |
| CLI / `river run`              | Run the CLI directly from local or any CI                                              |                 Yes (runner reads it from repo root)                  | Pre-PR self-review, headless runs                              |
| Plugin (Claude Code / Codex …) | Strengthen the agent's review ability via skills                                       | No (the agent applies skills; repo rules come from `.river/rules.md`) | Interactive review, agent-driven development                   |
| Skill adoption only            | Port only the review viewpoints into your own agent skills without installing the core |               No (follows the destination's operation)                | Importing viewpoints into an existing in-house review workflow |

Rules of thumb:

- You want automated PR review first → **GitHub Actions**
- You want the agent to review interactively → **Plugin**
- You already have in-house skills/workflow and only want the viewpoints → **Skill adoption only**

> **How `.river-review.json` is read**: The config file is read on the `river run` / CLI / Action-runner path from the repo root (searched in the order `.river-review.json` / `.river-review.yaml` / `.river-review.yml`). On the Plugin path the agent applies skills, so instead of the config file your repository rules in `.river/rules.md` / `.river/rules.d/*.md` take effect (see [repo-wide review](./repo-wide-review.en.md)). To avoid "I dropped a config file but nothing changed," confirm which path you are on first.

## 2. Rollout policy (staged adoption)

Starting with a blocking gate tends to slow development down via false positives. Tightening in this order is safer:

1. **comment-only**: Only post review results as PR comments; do not fail CI. Observe noise volume and usefulness first.
2. **fail-if-required (warn)**: Fail on `critical` only; keep `major` as a warning. Gate only on serious findings.
3. **blocking gate**: Promote to a required check and block merge above a chosen severity.

Severity-to-failure mapping (CLI / runner defaults):

- `critical` = fail
- `major` = fail-if-required (default: warn)
- `minor` = comment-only
- `info` = skipped

Examples of low-noise initial settings:

- Start from a small official [Skill Pack](./use-skill-packs.en.md) (scope with `--skill-set`).
- Apply only to the artifacts/files relevant to the change ([repo-wide review](./repo-wide-review.en.md) tuning).
- Narrow target PRs via label control (`prLabelsToIgnore`).
- Start from the "pre-PR local + post-PR labeled automation" of the [two-stage review gate](./two-stage-review-gate.en.md).

## 3. Promote viewpoints into skills / fixtures / suppression

In ongoing operation, turning review results into assets at the following granularity prevents staleness:

- **accepted (useful findings)**: If you want a viewpoint repeatedly, codify it as a skill ([add a new skill](./add-new-skill.en.md)).
- **false positive**: Pin deterministically-decidable false positives as a skill fixture (false-positive guard case) to prevent regressions. Handle project-specific cases via the [suppression workflow](./repo-wide-review.en.md#false-positive-suppression-memory) (`suppression-feedback`).
- **missed issue**: Turn missed viewpoints into a new fixture (happy path) and a skill viewpoint.

This promotion loop codifies AI-review judgment into reproducible checks. For the judgment units, see [choosing skills](./choose-skills.en.md) and the [skill-writing guide](./write-a-skill.en.md).

## 4. Drift detection for Skill-adoption-only

With "Skill adoption only," when upstream (River Review) improves a skill, the porting side cannot tell, so the copy goes stale over time. Two machine-readable footholds detect this:

- **Skill manifest**: `docs/data/skill-manifest.json` records each skill's `id` / `path` / `checksum` (a content hash). Compare the checksum of the skill you ported against your copy to detect upstream changes automatically in CI.
- **"Skills changed" in release notes**: Each release's notes list the skills that changed since the previous release (Changed / Added / Removed), so you can track which viewpoints to revisit per release.

Locally, `npm run skills:changelog -- --base <prev-tag> --head <tag>` produces the same diff.

## Common failures and fixes

| Failure                                   | Cause                                              | Fix                                                                                  |
| ----------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Dropped a config file but nothing changed | The Plugin path does not read `.river-review.json` | Confirm the path; on the Plugin path use `.river/rules.md` (§1)                      |
| Gating too early stalls development       | Blocking from the start                            | Adopt in stages from comment-only (§2)                                               |
| Viewpoints overlap with in-house skills   | Responsibility boundary undefined                  | Decide Skill-adoption-only vs Plugin and consolidate overlapping viewpoints (§1, §3) |

## See also

- [Set up River Review with GitHub Actions](./github-actions.en.md)
- [Using Skill Packs](./use-skill-packs.en.md)
- [Two-stage review gate (pre-PR + post-PR)](./two-stage-review-gate.en.md)
- [Repo-wide review setup and tuning](./repo-wide-review.en.md)
- [Choosing and combining skills](./choose-skills.en.md)
