# Connection Example for Skill Planner (LLM-based Skill Selection)

The Skill Planner works by simply injecting it as a `planner` (or `planner.plan`) function to `review-runner`. It works deterministically without an LLM, but here is a minimal implementation example using an LLM.

## Interface

- Input: `llmPlan({ skills, context })`
  - `skills`: `summarizeSkill`-ed metadata array (id/name/description/phase/applyTo/inputContext/outputKind/modelHint/dependencies/tags/severity)
  - `context`: `phase` / `changedFiles` / `availableContexts` (can extend with diff summary or PR info if needed)
- Output: `[{ id, reason? }]` (Array order is execution order. `priority` is currently unused)

## Minimal Implementation Example (Node + fetch)

```js
import { buildExecutionPlan } from './src/lib/review-runner.mjs';

// LLM call wrapper (replaceable with any provider)
async function llmPlan({ skills, context }) {
  const prompt = [
    'You are a code-review skill planner.',
    `Phase: ${context.phase}`,
    `Changed files: ${context.changedFiles.join(', ') || 'none'}`,
    'Skills:',
    ...skills.map((s) => `- ${s.id}: ${s.name} (${s.inputContext.join('/') || 'any'})`),
    'Return JSON array of {id, reason} in execution order.',
  ].join('\n');

  const res = await fetch(process.env.LLM_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.LLM_API_KEY}`,
    },
    body: JSON.stringify({ prompt }),
  });
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

// Example embedding into runner
const plan = await buildExecutionPlan({
  phase: 'midstream',
  changedFiles: ['src/foo.js'],
  availableContexts: ['diff', 'fullFile'],
  planner: llmPlan,
});
console.log(plan.selected.map((s) => s.metadata.id));
```

## Operational Notes

- If no LLM is passed (planner unspecified), it runs with deterministic sorting.
- If LLM call fails, it automatically falls back to deterministic order, recording the reason in `plannerReasons`.
- Keep API keys and endpoints in `.env` and do not commit them to the repository.
- It is recommended to use `try/catch` around LLM response parsing to fall back to deterministic order on failure (default `planSkills` logic does this).
