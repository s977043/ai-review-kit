# Community Skill Eval Runbook (#868 Phase 3 / #911 Phase 1 promotion)

Workflow to generate verified `golden/` outputs for community skills and
promote them from `recommended: false` to `recommended: true` in
`skills/registry.yaml`.

## Project policy on API keys

API keys are **not** stored as GitHub repo secrets. They live on the
developer's local machine. The Actions workflow exists as an optional
fallback for future use; the primary path is local execution.

## Preferred: local execution

Set at least one of `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` in your shell,
then:

```bash
scripts/run-promptfoo-eval.sh                          # all community skills
scripts/run-promptfoo-eval.sh modern-web-semantic      # egrep filter on path
PROVIDER_FILTER=anthropic:claude-3-5-sonnet-20241022 \
  scripts/run-promptfoo-eval.sh                        # limit provider/cost
```

Outputs land in `./eval-output/<skill-id>.json` per evaluated skill.

## Agent-based / unified eval path

The repo also ships a unified evaluation runner and two associated CI
workflows that cover community skills with a different purpose from the
promptfoo path.

### Local unified eval

```bash
node scripts/evaluate-all.mjs          # evaluate all skills
```

Requires the same API key env vars as the promptfoo path. Results are
written per-skill under `./eval-output/`.

### Scheduled regression tracking (nightly-eval.yml)

`.github/workflows/nightly-eval.yml` runs `evaluate-all.mjs` on a
daily schedule (04:00 JST) against all skills. Use this workflow to
track regressions across the full skill set over time without manual
intervention.

### CI config check on skill changes (skill-eval.yml)—not a merge gate

`.github/workflows/skill-eval.yml` triggers automatically on PR/push
whenever skill eval, prompt, fixture, or golden files change. It does
**not** gate merges: `Skill Evaluation` is not among main's required
status checks, and because no API keys are registered as repo secrets,
the `Run evaluation` and `Check must_include assertions` steps are
skipped. What remains is `Validate config (no API keys)`, which checks
`promptfoo.yaml` YAML syntax and the existence of referenced files.

The deterministic merge gate for skills is `npm run skills:validate`
(`scripts/validate-skills.mjs`), run by the required `Skill schema
validation` check—it enforces eval/fixture coverage for recommended
skills and fixture drift. See `docs/skills-structure.md`.

### When to use which path

| Goal                                                            | Path                                                            |
| --------------------------------------------------------------- | --------------------------------------------------------------- |
| Generate or iterate on per-skill fixtures and promote goldens   | promptfoo path (`run-promptfoo-eval.sh` / `promptfoo-eval.yml`) |
| Continuous regression tracking across all skills                | `evaluate-all.mjs` / `nightly-eval.yml`                         |
| Eval-config sanity check when a skill's files change (advisory) | `skill-eval.yml` (automatic)                                    |
| Merge gate for skill structure, eval coverage, fixture drift    | `npm run skills:validate` (`Skill schema validation`)           |

## Fallback: GitHub Actions workflow

Only use this path if API keys are eventually added as repo secrets and
contributors want the eval to run on shared infrastructure.

1. Add `OPENAI_API_KEY` and/or `ANTHROPIC_API_KEY` under Settings → Secrets
   and variables → Actions.
2. Go to **Actions → Promptfoo Eval (community skills) → Run workflow**.
3. (Optional) `skill_filter` / `provider_filter` inputs.
4. Download the `promptfoo-eval-output` artifact from the run.

## Review and commit goldens

1. Unzip the artifact; you'll get one `<skill-id>.json` per evaluated skill.
2. For each test in each skill, compare the LLM output against the
   `llm-rubric` assertion in `eval/promptfoo.yaml`.
3. If the output matches the rubric and the SKILL.md Output contract:
   - Extract the relevant text block.
   - Save it to `skills/midstream/community/<skill-id>/golden/<fixture-name>.md`.
4. If the output is wrong: fix the prompt (`prompt/system.md` or
   `prompt/user.md`), commit, re-run the workflow until consistent.

## Promote to `recommended: true`

A skill is eligible for `recommended: true` when all of:

- `eval/promptfoo.yaml` exists and all assertions pass on the latest run
- Every fixture has a matching `golden/<fixture-name>.md`
- At least one provider has produced consistent output across 3 runs

Edit `skills/registry.yaml`, flip `recommended: false → true` for the skill,
open a PR referencing the eval artifact URL in the description.

## Cost guidance

- Use `provider_filter` to limit to one provider per run while iterating.
- `temperature: 0.1` is set in the yaml configs; eval reruns should be cheap.
- For #868 Phase 2 skills (6 community skills × 2 fixtures × 2 providers),
  total cost per full run is typically under $1 at current pricing.

## References

- Workflows: `.github/workflows/promptfoo-eval.yml`,
  `.github/workflows/nightly-eval.yml`,
  `.github/workflows/skill-eval.yml`
- Skill READMEs document the per-skill workflow.
- Issues: [#868](https://github.com/s977043/river-review/issues/868),
  [#911](https://github.com/s977043/river-review/issues/911).
- Promptfoo docs: <https://www.promptfoo.dev/docs/configuration/guide>
