// ---------------------------------------------------------------------------
// applyto-coverage.mjs — pure helpers for the entry-skill `applyTo` containment
// check (issue #1508). An entry skill (agent-skills router) must let every diff
// that its routing-target registry skills care about reach the entry, i.e. the
// union of the targets' `applyTo` globs must be covered by the entry's own
// `applyTo`. See validate-agent-skills.mjs for the file IO and reporting layer.
// ---------------------------------------------------------------------------

import { expandBraces, globOverlaps } from './glob-subset.mjs';

// Single-word IDs (no hyphen) are legal skill IDs too; requiring a hyphen would
// silently drop them from both candidates and the unresolved-target warning.
const KEBAB_ID = /`([a-z0-9]+(?:-[a-z0-9]+)*)`/g;

/**
 * Extract candidate routing-target skill IDs from a routing document. To stay
 * tolerant of per-entry table shapes (issue #1508 "既知の難所"), an ID counts
 * when it appears as a backtick-wrapped kebab-case token on a routing line:
 *
 *  - a markdown table row (starts with `|`): every backtick ID in the row is a
 *    candidate (the skill-ID column plus any referenced in the description).
 *  - an arrow line (contains `→`/`->`): every backtick ID after the arrow is a
 *    candidate — combo routes list several targets on one line (e.g.
 *    "→ `typescript-strict` + `typescript-nullcheck`") — EXCEPT IDs inside
 *    full-width parentheses `（...）`, which are "see also" cross-references,
 *    not route targets (e.g. "→ `river-review-frontend`
 *    （`nextjs-app-router-boundary`）も参照").
 *
 * Prose mentions elsewhere are ignored entirely.
 *
 * @param {string} text
 * @returns {string[]} unique IDs in first-seen order
 */
export function extractRoutingTargetIds(text) {
  const ids = [];
  const seen = new Set();
  const push = (id) => {
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  };
  for (const rawLine of String(text ?? '').split('\n')) {
    const line = rawLine.trim();
    if (line.startsWith('|')) {
      for (const match of rawLine.matchAll(KEBAB_ID)) push(match[1]);
      continue;
    }
    const arrowCandidates = [line.indexOf('→'), line.indexOf('->')].filter((i) => i !== -1);
    if (!arrowCandidates.length) continue;
    const arrowIdx = Math.min(...arrowCandidates);
    // Drop full-width parenthesized spans (see-also cross-references), then take
    // every backtick ID after the arrow (`+` / `、`-separated combos included).
    const afterArrow = line.slice(arrowIdx).replace(/（[^）]*）/g, '');
    for (const match of afterArrow.matchAll(KEBAB_ID)) push(match[1]);
  }
  return ids;
}

/**
 * Expand a raw `applyTo` list (array or single string) into concrete,
 * brace-free glob patterns.
 * @param {string[]|string|undefined} applyTo
 * @returns {string[]}
 */
export function expandApplyTo(applyTo) {
  const list = Array.isArray(applyTo) ? applyTo : applyTo ? [applyTo] : [];
  return list.flatMap((p) => expandBraces(String(p)));
}

/**
 * Analyze whether an entry's expanded `applyTo` patterns reach a routing
 * target's expanded `applyTo` patterns.
 *
 * Decided false-positive-first (repo principle #1070). The reported gap is
 * limited to target patterns that are *entirely disjoint* from the whole entry
 * `applyTo` — i.e. a whole file category (an extension or path prefix) the entry
 * never fires on. This is the precise #1494 / #1500 signal (config-only diffs,
 * `route.ts` files) and avoids the noise of flagging every extension-set or
 * path-granularity difference where the pattern still overlaps the entry. An
 * undecidable comparison never proves disjointness (the pattern is treated as
 * reachable).
 *
 * @param {string[]} entryPatterns   entry `applyTo`, brace-expanded
 * @param {string[]} targetPatterns  target `applyTo`, brace-expanded
 * @returns {{ reachable: boolean, disjoint: string[], undecidable: boolean }}
 *   - reachable: false only when every target pattern is provably disjoint from
 *     every entry pattern (⇒ the routed skill can never fire via this entry).
 *   - disjoint: target patterns provably disjoint from every entry pattern.
 *   - undecidable: at least one comparison returned 'unknown'.
 */
export function analyzeCoverage(entryPatterns, targetPatterns) {
  let undecidable = false;
  const disjoint = [];

  for (const t of targetPatterns) {
    let overlapsSomewhere = false;
    for (const e of entryPatterns) {
      const overlap = globOverlaps(e, t);
      if (overlap === 'yes' || overlap === 'unknown') {
        overlapsSomewhere = true;
        if (overlap === 'unknown') undecidable = true;
        break;
      }
    }
    if (!overlapsSomewhere) disjoint.push(t);
  }

  return {
    reachable: targetPatterns.length === 0 ? true : disjoint.length < targetPatterns.length,
    disjoint,
    undecidable,
  };
}
