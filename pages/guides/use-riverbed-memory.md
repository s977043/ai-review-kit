# Use Riverbed Memory

Riverbed Memory stores past review context so future flows stay consistent.

## Steps

1. Capture decisions: add short notes in PR descriptions for upstream design choices and link them from skill instructions when relevant.
2. Persist signals: store approved review outcomes (for example, in a `logs/` or database layer) keyed by skill ID and phase.
   For example, keep `logs/review_outcomes.json` like:

   ```json
   {
     "skill-123": {
       "phase": "upstream",
       "outcome": "approved",
       "notes": "Design aligns with upstream architecture."
     },
     "skill-456": {
       "phase": "midstream",
       "outcome": "approved",
       "notes": "Code meets performance requirements."
     }
   }
   ```

3. Reuse context: when writing new skills, reference prior decisions to avoid duplicate warnings or conflicting guidance.
4. Expire stale memory: set a cadence (for example, monthly) to prune outdated decisions and refresh assumptions.

## Good Practices

- Keep memory entries small and action-oriented (what changed, why, and the phase).
- Prefer structured formats (JSON/YAML) so automation can hydrate the reviewer.
