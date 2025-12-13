export const PLANNER_MODES = /** @type {const} */ (['off', 'order', 'prune']);

export function normalizePlannerMode(mode, { defaultMode = 'off' } = {}) {
  const fallback = PLANNER_MODES.includes(defaultMode) ? defaultMode : 'off';
  const normalized = (mode || '').toLowerCase();
  if (PLANNER_MODES.includes(normalized)) return normalized;
  return fallback;
}

