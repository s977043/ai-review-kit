/**
 * Gate → CLI exit-code mapping (Epic #1347 S4 PR-C, #1351).
 *
 * `--gate` turns the machine-readable gate decision into a process exit code so
 * a CI job / autonomous loop can enforce it. The escalation tier gets a
 * DEDICATED code (3) so an exit-code-only consumer cannot mistake a "cliff"
 * (human approval required) for a normal revise/fail — keeping the Epic's
 * "崖 = HITL preserved" invariant at the CI boundary.
 *
 *   GO | GO_WITH_OBSERVATION → 0   (proceed; hill tier still proceeds)
 *   NO_GO                    → 1   (revise / fail — same as --fail-on)
 *   ESCALATE                 → 3   (human approval required; unused by run)
 *   unknown / undefined      → 1   (fail-safe: an underived gate never exits 0)
 *
 * Pure / side-effect-free.
 */

/**
 * @param {string|undefined} decision - gate.decision
 * @returns {0|1|3}
 */
export function gateDecisionExitCode(decision) {
  switch (decision) {
    case 'GO':
    case 'GO_WITH_OBSERVATION':
      return 0;
    case 'ESCALATE':
      return 3;
    case 'NO_GO':
      return 1;
    default:
      return 1; // fail-safe — never exit 0 on an unknown/underived gate
  }
}

// Exit-code severity precedence (NOT numeric order): a warn (2) must never mask
// a hard fail (1) or an escalation (3). Higher rank wins.
const EXIT_SEVERITY_RANK = { 0: 0, 2: 1, 1: 2, 3: 3 };

/**
 * Combine exit codes by severity precedence: escalate(3) > fail(1) > warn(2) >
 * pass(0). Used when `--gate` runs alongside `--fail-on`/`--warn-on` so the
 * stricter outcome wins — numeric `Math.max` would wrongly let warn(2) beat
 * fail(1).
 *
 * @param {...number} codes
 * @returns {number}
 */
export function combineExitCodes(...codes) {
  let best = 0;
  let bestRank = 0;
  for (const c of codes) {
    const rank = EXIT_SEVERITY_RANK[c] ?? EXIT_SEVERITY_RANK[1]; // unknown → fail rank
    // Track bestRank explicitly: re-deriving it as EXIT_SEVERITY_RANK[best]
    // would yield undefined→0 for an unknown `best` and let a lower-rank code
    // (e.g. warn) overwrite it (gemini #1404).
    if (rank > bestRank) {
      best = c;
      bestRank = rank;
    }
  }
  return best;
}
