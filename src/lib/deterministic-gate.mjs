/**
 * Deterministic strict_block detection (Epic #1347 S4, #1351).
 *
 * Consumes the previously declaration-only skill schema fields
 * `evaluationType: 'deterministic'` and `deterministicGate.failSeverity`.
 * A finding from a deterministic skill whose gate is `strict_block` is a
 * NON-NEGOTIABLE hard block: deterministic detectors are authoritative (see
 * `.claude/rules/review-core.md` §#1070 — static analysis owns the syntactic /
 * pattern layer 100%, and the AI review must not re-adjudicate it). The gate
 * turns that into an unconditional NO_GO (reasonCode STRICT_BLOCK) that blocks
 * even below the critical/major severity floor and that a label-skip or dry-run
 * cannot waive.
 *
 * Design principle preserved: enforcement is OPT-IN. A skill blocks only when
 * it EXPLICITLY declares a `deterministicGate` object; a deterministic skill
 * with no declared gate stays advisory.
 *
 * Pure / side-effect-free.
 */

/** deterministicGate.failSeverity vocabulary (mirrors skillYamlSchema.mjs). */
export const STRICT_BLOCK = 'strict_block';
export const BYPASS_WARNING = 'bypass_warning';

function skillMeta(skill) {
  return skill?.metadata ?? skill ?? {};
}

/**
 * True when a skill's findings are deterministic hard blocks: it declares
 * `evaluationType: 'deterministic'` AND an explicit `deterministicGate` whose
 * `failSeverity` is `strict_block` (the schema default within the gate object,
 * so an omitted failSeverity on a declared gate still blocks).
 *
 * @param {object} skill - loaded skill (full object with `.metadata`) or a bare metadata object
 * @returns {boolean}
 */
export function isStrictBlockSkill(skill) {
  const m = skillMeta(skill);
  if (m.evaluationType !== 'deterministic') return false;
  const gate = m.deterministicGate;
  if (!gate || typeof gate !== 'object') return false; // no declared gate → advisory
  return (gate.failSeverity ?? STRICT_BLOCK) === STRICT_BLOCK;
}

/**
 * Identify findings that originate from a deterministic strict_block skill.
 *
 * A finding's `ruleId` is its emitting skill's id (review-engine sets
 * `ruleId = c.skillId`). Callers should pass the PRE-suppression finding set so
 * that a suppressed deterministic block still forces the gate — a suppression
 * must not become a strict_block bypass (same fail-safe stance as
 * SKIPPED_BY_POLICY in gate-decision.mjs).
 *
 * @param {object} params
 * @param {Array<object>} [params.findings] - review findings (ruleId = skillId)
 * @param {Array<object>} [params.selected] - selected skills (full objects with metadata)
 * @returns {{ strictBlock: boolean, findings: Array<object> }}
 */
export function computeStrictBlock({ findings, selected } = {}) {
  const strictIds = new Set(
    (Array.isArray(selected) ? selected : [])
      .filter(isStrictBlockSkill)
      .map((s) => String(skillMeta(s).id ?? ''))
      .filter(Boolean)
  );
  const blocking =
    strictIds.size === 0
      ? []
      : (Array.isArray(findings) ? findings : []).filter(
          (f) => f != null && strictIds.has(String(f.ruleId ?? ''))
        );
  return { strictBlock: blocking.length > 0, findings: blocking };
}
