// Phase inference (#1565) — deterministic, side-effect-free.
//
// Infers a review phase (upstream / midstream / downstream) from the file-type
// classification produced by `classifyChangedFiles()` in file-classifier.mjs.
//
// Stage 1 (observe) scope: this result is recorded on the execution plan
// snapshot (`snapshot.inferredPhase`) for measurement only. It MUST NOT change
// the actual phase selection, skill selection, or gate decisions. Applying the
// inferred phase (Stage 2, `--phase auto`) is a separate change.
//
// Rules (priority order, conservative — fail-safe to `midstream` matches the
// current default behavior so observe mode never diverges):
//
//   1. docs present and no app/test/schema/migration changes  -> upstream
//   2. tests present and no app changes                        -> downstream
//   3. app changes present                                     -> midstream
//   4. anything else (config/infra/schema/migration/unknown
//      only, undecidable mix, empty)                           -> midstream (fail-safe)

const DEFAULT_PHASE = 'midstream';

/**
 * @typedef {object} InferredPhase
 * @property {'upstream'|'midstream'|'downstream'} phase - Inferred phase.
 * @property {'high'|'low'} confidence - `high` when a rule matched positively;
 *   `low` for the fail-safe default (no rule matched).
 * @property {string} reason - Human-readable justification, e.g. `docs-only diff (3 files)`.
 */

/**
 * Infer a review phase from the output of `classifyChangedFiles()`.
 *
 * Deterministic pure function: same input always yields the same output, no
 * side effects, no I/O, no LLM. Only reads array lengths from `fileTypes`.
 *
 * @param {{ config?: string[], schema?: string[], migration?: string[], app?: string[], test?: string[], infra?: string[], docs?: string[], unknown?: string[] }} fileTypes
 *   File-type buckets as returned by `classifyChangedFiles()`. Missing keys are
 *   treated as empty.
 * @returns {InferredPhase}
 */
export function inferPhase(fileTypes) {
  const ft = fileTypes ?? {};
  const count = (key) => (Array.isArray(ft[key]) ? ft[key].length : 0);

  const app = count('app');
  const test = count('test');
  const docs = count('docs');
  const schema = count('schema');
  const migration = count('migration');

  // Rule 1: docs-only diff (no code-ish changes) -> upstream (design/ADR PRs).
  if (docs > 0 && app === 0 && test === 0 && schema === 0 && migration === 0) {
    return {
      phase: 'upstream',
      confidence: 'high',
      reason: `docs-only diff (${docs} file${docs === 1 ? '' : 's'})`,
    };
  }

  // Rule 2: tests present and no app changes -> downstream (test/QA PRs).
  if (test > 0 && app === 0) {
    return {
      phase: 'downstream',
      confidence: 'high',
      reason: `test-only diff (${test} file${test === 1 ? '' : 's'})`,
    };
  }

  // Rule 3: app changes present -> midstream (implementation PRs).
  if (app > 0) {
    return {
      phase: 'midstream',
      confidence: 'high',
      reason: `app diff (${app} file${app === 1 ? '' : 's'})`,
    };
  }

  // Rule 4: fail-safe. Undecidable mix / config / infra / schema / migration /
  // unknown only / empty -> keep the current default, prefer no change over a
  // misroute.
  return {
    phase: DEFAULT_PHASE,
    confidence: 'low',
    reason: 'no confident phase signal; fail-safe to midstream',
  };
}
