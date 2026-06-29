# Using Independent Review Synthesis

A skill that synthesizes multiple AI / human review results to support the merge decision.
Inspired by Nolan Lawson's Triple Agent skill, but avoiding tool lock-in and
restructured to fit River Review's artifact-driven philosophy — a "synthesis pattern".

- Skill: `independent-review-synthesis`
- Related epic: [#911](https://github.com/s977043/river-review/issues/911)
- Status: Phase 1 (community / `recommended: false`). Phase 2 will extend the artifact contract; Phase 3 will add a CLI ensemble mode.

## When to use

- **You want to aggregate multiple AI review results** (e.g. run Claude / Codex / Cursor / GitHub Copilot reviews in parallel and consolidate their output into one).
- **You want to combine AI and human review** (put the AI results in review-external and the author's self-review in review-self).
- **You want to decide based on findings from past PRs** (pass the history via findings-pool).

## When not to use

- A typical single-reviewer PR review → the existing midstream skills are enough.
- You want to add a new review viewpoint (security / a11y / performance) → create a dedicated skill.
- You want to automate the merge decision by majority vote of review results → this skill does not use majority vote. Hard rule 1.

## Inputs

Following the repository convention (`.river/` etc.), pass the following artifacts:

| artifact ID       | Format       | Role                                                             |
| ----------------- | ------------ | ---------------------------------------------------------------- |
| `diff`            | patch / diff | Required. The diff of the PR                                     |
| `review-self`     | Markdown     | Optional. The implementer's self-review                          |
| `review-external` | Markdown     | Optional. External AI / human review                             |
| `findings-pool`   | JSON         | Optional. Findings history aggregated from past Review Artifacts |
| `fullFile`        | source       | Optional. Improves accuracy in the verification step             |

For artifact definitions, see [Artifact Input Contract](../reference/artifact-input-contract.md).

## Output

A fixed 6 sections:

1. Critical Issues
2. Major Issues
3. Minor Issues
4. Dismissed Findings (hallucination / duplicate)
5. Agent Agreement Summary (a list of which reviewer raised what — supplementary info)
6. Merge Recommendation (`merge-ready` / `human-review` / `block`)

Each finding uses the block form `Finding:` / `Evidence:` / `Reviewers:` / `Severity:` / `ValidatedStatus:` / `Suggestion:`.

## Design principles

- **No majority vote**: `Reviewers:` is supplementary info. `Severity` / `ValidatedStatus` are decided by evidence quality.
- **Hallucination guard**: verify with grep whether each finding's `Evidence:` exists in the actual code. If not found, mark it `dismissed-hallucination`.
- **Single-reviewer findings are acceptable**: even a finding raised by a single reviewer is confirmed if it has evidence.
- **No critical without evidence**: the severity ceiling is `major`.
- **No provider lock-in**: do not write the names Claude / Codex / Cursor in the skill body.

## Local evaluation

Verify behavior with `promptfoo eval`:

```bash
cd skills/midstream/community/independent-review-synthesis/eval
promptfoo eval
```

`OPENAI_API_KEY` / `ANTHROPIC_API_KEY` are required. In Phase 1, `golden/` stays empty (hand-written goldens fall under this repository's "posture, not progress" anti-pattern). Save outputs generated from real LLM runs and proceed along the promotion path.

## Phase 1 limitations

- The artifact contract reuses the existing `review-self` / `review-external` / `findings-pool` as-is.
- Provenance fields on `findings[]` (`reviewer`, `agreement[]`, `validatedStatus`) are a Phase 2 schema extension.
- CLI shortcuts (`--ensemble claude,codex,cursor`, etc.) are Phase 3.
- Currently only **skill body + fixtures + eval scaffolding** exist.
